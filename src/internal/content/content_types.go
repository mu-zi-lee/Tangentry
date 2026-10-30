package content

type Item struct {
	Transcripts     []Transcript   `json:"transcripts,omitempty"`
	Images          []Image        `json:"images,omitempty"`
	ArticleBlocks   []ArticleBlock `json:"articleBlocks,omitempty"`
	Discussion      *Discussion    `json:"discussion,omitempty"`
	Paper           *PaperMetadata `json:"paper,omitempty"`
	MediaURL        string         `json:"mediaUrl,omitempty"`
	ID              string         `json:"id"`
	Platform        string         `json:"platform"`
	PlatformID      string         `json:"platformId"`
	Kind            string         `json:"kind"`
	Title           string         `json:"title"`
	Author          string         `json:"author"`
	AuthorID        string         `json:"authorId"`
	AuthorAvatarURL string         `json:"authorAvatarUrl,omitempty"`
	Category        string         `json:"category,omitempty"`
	ReplyCount      int            `json:"replyCount,omitempty"`
	LikeCount       int            `json:"likeCount,omitempty"`
	URL             string         `json:"url"`
	ThumbnailURL    string         `json:"thumbnailUrl"`
	ThumbnailWidth  int            `json:"thumbnailWidth,omitempty"`
	ThumbnailHeight int            `json:"thumbnailHeight,omitempty"`
	Description     string         `json:"description"`
	PreviewText     string         `json:"previewText,omitempty"`
	DurationSeconds int            `json:"durationSeconds"`
	PublishedAt     int64          `json:"publishedAt"`
	ViewCount       int64          `json:"viewCount,omitempty"`
	PublishedText   string         `json:"publishedText,omitempty"`
	SavedAt         int64          `json:"savedAt,omitempty"`
	// Partial marks a card projection: bodies, transcripts and long
	// descriptions are left out, so it must never be saved back.
	Partial bool `json:"partial,omitempty"`
}

// PaperMetadata carries scholarly links and source metadata without folding
// them into the free-form description shown by ordinary content items.
type PaperMetadata struct {
	ArxivID     string   `json:"arxivId"`
	Title       string   `json:"title,omitempty"`
	DocumentID  string   `json:"documentId,omitempty"`
	Authors     []string `json:"authors,omitempty"`
	Categories  []string `json:"categories,omitempty"`
	AIKeywords  []string `json:"aiKeywords,omitempty"`
	Abstract    string   `json:"abstract,omitempty"`
	Version     int      `json:"version,omitempty"`
	PublishedAt int64    `json:"publishedAt,omitempty"`
	UpdatedAt   int64    `json:"updatedAt,omitempty"`
	PDFURL      string   `json:"pdfUrl,omitempty"`
	ArxivURL    string   `json:"arxivUrl,omitempty"`
	HFURL       string   `json:"hfUrl,omitempty"`
	GitHubURL   string   `json:"githubUrl,omitempty"`
	AlphaXivURL string   `json:"alphaXivUrl,omitempty"`
	AISummary   string   `json:"aiSummary,omitempty"`
	GitHubStars int      `json:"githubStars,omitempty"`
	Upvotes     int      `json:"upvotes,omitempty"`
}

type Discussion struct {
	TopicID       string           `json:"topicId"`
	TotalPosts    int              `json:"totalPosts"`
	LoadedPosts   int              `json:"loadedPosts"`
	Participating int              `json:"participatingUsers,omitempty"`
	PostIDs       []int64          `json:"postIds,omitempty"`
	Posts         []DiscussionPost `json:"posts"`
}

type DiscussionPost struct {
	ID            int64          `json:"id"`
	Number        int            `json:"number"`
	Username      string         `json:"username"`
	Name          string         `json:"name,omitempty"`
	AvatarURL     string         `json:"avatarUrl,omitempty"`
	CreatedAt     int64          `json:"createdAt"`
	LikeCount     int            `json:"likeCount,omitempty"`
	ReplyToNumber int            `json:"replyToNumber,omitempty"`
	ReplyToUser   string         `json:"replyToUser,omitempty"`
	ReplyToPostID int64          `json:"replyToPostId,omitempty"`
	Blocks        []ArticleBlock `json:"blocks"`
}

// ArticleBlock is the safe, structured subset of an article that can be
// rendered by the reader. Image URLs are kept separate from text so feeds do
// not have to expose arbitrary HTML to the frontend.
type ArticleBlock struct {
	Kind         string               `json:"kind"`
	Level        int                  `json:"level,omitempty"`
	Group        int                  `json:"group,omitempty"`
	Ordered      bool                 `json:"ordered,omitempty"`
	Text         string               `json:"text"`
	Summary      string               `json:"summary,omitempty"`
	URL          string               `json:"url,omitempty"`
	Alt          string               `json:"alt,omitempty"`
	Width        int                  `json:"width,omitempty"`
	Height       int                  `json:"height,omitempty"`
	InlineImages []ArticleInlineImage `json:"inlineImages,omitempty"`
}

type ArticleInlineImage struct {
	Offset int    `json:"offset"`
	URL    string `json:"url"`
	Alt    string `json:"alt,omitempty"`
	Width  int    `json:"width,omitempty"`
	Height int    `json:"height,omitempty"`
}

type Transcript struct {
	URL      string `json:"url"`
	Type     string `json:"type"`
	Language string `json:"language,omitempty"`
}

// Images preserve album order without tying the library to a platform payload.
type Image struct {
	URL    string `json:"url"`
	Width  int    `json:"width,omitempty"`
	Height int    `json:"height,omitempty"`
	Alt    string `json:"alt,omitempty"`
}
