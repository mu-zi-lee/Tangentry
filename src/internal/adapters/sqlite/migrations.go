package sqlite

import (
	"database/sql"
	"embed"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

// Go steps run after a version's SQL in the same transaction, for data
// rewrites SQL alone cannot express.
var migrationSteps = map[int]func(*sql.Tx) error{14: archiveLegacySnapshots, 70: addBackupWebDAVColumns, 71: addBackupRetryColumns, 73: configureSingleBackupPlan, 84: addContentVersion}

// A file holding only one ADD COLUMN is skipped when the column exists:
// older builds added some columns before recording their version.
var addColumn = regexp.MustCompile(`(?is)^\s*ALTER TABLE (\w+) ADD COLUMN (\w+)[^;]*;\s*$`)

// The baseline is idempotent and reapplied on every open, as before the
// runner existed, so databases that recorded it without every table recover.
const baselineVersion = 6

type migration struct {
	version    int
	name, body string
}

// loadMigrations reads migrations/NNN_name.sql in version order.
func loadMigrations() ([]migration, error) {
	entries, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		return nil, err
	}
	out := make([]migration, 0, len(entries))
	seen := map[int]bool{}
	for _, entry := range entries {
		number, name, ok := strings.Cut(strings.TrimSuffix(entry.Name(), ".sql"), "_")
		version, err := strconv.Atoi(number)
		if !ok || err != nil || version <= 0 || seen[version] {
			return nil, fmt.Errorf("invalid migration file %q", entry.Name())
		}
		body, err := migrationFiles.ReadFile(path.Join("migrations", entry.Name()))
		if err != nil {
			return nil, err
		}
		seen[version] = true
		out = append(out, migration{version, name, string(body)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	return out, nil
}

// migrate applies, in order, every version schema_version has not recorded.
// Each version commits with its record, so an interrupted upgrade resumes.
func migrate(db *sql.DB) error {
	migrations, err := loadMigrations()
	if err != nil {
		return err
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`); err != nil {
		return fmt.Errorf("initialize schema version: %w", err)
	}
	for _, m := range migrations {
		if err := apply(db, m); err != nil {
			return fmt.Errorf("migrate %03d_%s: %w", m.version, m.name, err)
		}
	}
	return nil
}

func apply(db *sql.DB, m migration) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var recorded int
	if err := tx.QueryRow(`SELECT count(*) FROM schema_version WHERE version=?`, m.version).Scan(&recorded); err != nil {
		return err
	}
	if recorded > 0 {
		if m.version == baselineVersion {
			if _, err := tx.Exec(m.body); err != nil {
				return err
			}
			return tx.Commit()
		}
		return nil
	}
	present := 0
	if match := addColumn.FindStringSubmatch(m.body); match != nil {
		if err := tx.QueryRow(`SELECT count(*) FROM pragma_table_info(?) WHERE name=?`, match[1], match[2]).Scan(&present); err != nil {
			return err
		}
	}
	if present == 0 {
		if _, err := tx.Exec(m.body); err != nil {
			return err
		}
	}
	if step := migrationSteps[m.version]; step != nil {
		if err := step(tx); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`INSERT INTO schema_version(version) VALUES(?)`, m.version); err != nil {
		return err
	}
	return tx.Commit()
}

func addBackupWebDAVColumns(tx *sql.Tx) error {
	for _, statement := range []string{
		`ALTER TABLE backup_target ADD COLUMN endpoint TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE backup_target ADD COLUMN username TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE backup_target ADD COLUMN remote_path TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE backup_target ADD COLUMN allow_insecure_tls INTEGER NOT NULL DEFAULT 0 CHECK(allow_insecure_tls IN (0,1))`,
	} {
		match := regexp.MustCompile(`(?is)^ALTER TABLE (\w+) ADD COLUMN (\w+)`).FindStringSubmatch(statement)
		var exists int
		if err := tx.QueryRow(`SELECT count(*) FROM pragma_table_info(?) WHERE name=?`, match[1], match[2]).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			continue
		}
		if _, err := tx.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}

func addBackupRetryColumns(tx *sql.Tx) error {
	for _, statement := range []string{
		`ALTER TABLE backup_run ADD COLUMN retry_unavailable_reason TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE backup_run_target ADD COLUMN position INTEGER NOT NULL DEFAULT 0`,
	} {
		match := regexp.MustCompile(`(?is)^ALTER TABLE (\w+) ADD COLUMN (\w+)`).FindStringSubmatch(statement)
		var exists int
		if err := tx.QueryRow(`SELECT count(*) FROM pragma_table_info(?) WHERE name=?`, match[1], match[2]).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			if _, err := tx.Exec(statement); err != nil {
				return err
			}
		}
	}
	_, err := tx.Exec(`UPDATE backup_run_target
		SET position = COALESCE((
			SELECT backup_task_target.position
			FROM backup_run
			JOIN backup_task_target ON backup_task_target.task_id = backup_run.task_id
			WHERE backup_run.id = backup_run_target.run_id
			AND backup_task_target.target_id = backup_run_target.target_id
		), backup_run_target.position)`)
	return err
}

func configureSingleBackupPlan(tx *sql.Tx) error {
	var exists int
	if err := tx.QueryRow(`SELECT count(*) FROM pragma_table_info('backup_task_target') WHERE name='interval_hours'`).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		if _, err := tx.Exec(`ALTER TABLE backup_task_target ADD COLUMN interval_hours INTEGER NOT NULL DEFAULT 0 CHECK(interval_hours BETWEEN 0 AND 720)`); err != nil {
			return err
		}
	}
	rows, err := tx.Query(`SELECT id,name,include_downloads,retention,enabled,interval_hours FROM backup_task ORDER BY id`)
	if err != nil {
		return err
	}
	type oldTask struct {
		id, name                                       string
		includeDownloads, retention, enabled, interval int
	}
	var tasks []oldTask
	for rows.Next() {
		var task oldTask
		if err := rows.Scan(&task.id, &task.name, &task.includeDownloads, &task.retention, &task.enabled, &task.interval); err != nil {
			rows.Close()
			return err
		}
		tasks = append(tasks, task)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(tasks) < 2 {
		return nil
	}
	primary := tasks[0]
	includeDownloads, enabled := primary.includeDownloads, 0
	retention, interval := primary.retention, primary.interval
	if retention <= 0 {
		retention = 10
	}
	for _, task := range tasks {
		if task.includeDownloads != 0 {
			includeDownloads = 1
		}
		if task.enabled != 0 {
			enabled = 1
		}
		if task.retention > retention {
			retention = task.retention
		}
		if task.interval > interval {
			interval = task.interval
		}
	}
	if interval < 1 || interval > 720 {
		interval = 6
	}
	if _, err := tx.Exec(`UPDATE backup_task SET include_downloads=?,retention=?,enabled=?,interval_hours=? WHERE id=?`, includeDownloads, retention, enabled, interval, primary.id); err != nil {
		return err
	}
	seen := make(map[string]bool)
	for _, task := range tasks {
		bindings, err := tx.Query(`SELECT target_id,position,interval_hours FROM backup_task_target WHERE task_id=? ORDER BY position,target_id`, task.id)
		if err != nil {
			return err
		}
		for bindings.Next() {
			var targetID string
			var position, targetInterval int
			if err := bindings.Scan(&targetID, &position, &targetInterval); err != nil {
				bindings.Close()
				return err
			}
			if seen[targetID] {
				continue
			}
			seen[targetID] = true
			if _, err := tx.Exec(`INSERT OR IGNORE INTO backup_task_target(task_id,target_id,position,interval_hours) VALUES(?,?,?,?)`, primary.id, targetID, len(seen)-1, targetInterval); err != nil {
				bindings.Close()
				return err
			}
		}
		if err := bindings.Close(); err != nil {
			return err
		}
	}
	for _, task := range tasks[1:] {
		if _, err := tx.Exec(`DELETE FROM backup_task WHERE id=?`, task.id); err != nil {
			return err
		}
	}
	return nil
}
