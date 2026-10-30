// Package netpolicy supplies bounded public-Internet fetching for user-provided URLs.
//
// It is shared infrastructure rather than an external-service adapter: domain
// services use it to enforce the same URL and SSRF policy regardless of which
// remote provider they are talking to.
package netpolicy

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

func URL(raw string) (string, error) {
	if len(raw) > 2048 {
		return "", errors.New("invalid URL")
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.User != nil || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") || u.Opaque != "" {
		return "", errors.New("invalid URL")
	}
	if port := u.Port(); port != "" && port != "80" && port != "443" {
		return "", errors.New("unsupported URL port")
	}
	u.Fragment = ""
	return u.String(), nil
}
func public(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, cidr := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32", "2002::/16", "64:ff9b::/96"} {
		if netip.MustParsePrefix(cidr).Contains(ip) {
			return false
		}
	}
	return true
}
func newClient(timeout time.Duration) *http.Client {
	transport := &http.Transport{Proxy: nil, ResponseHeaderTimeout: 15 * time.Second, MaxIdleConns: 10, IdleConnTimeout: time.Minute}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, errors.New("destination unavailable")
		}
		for _, ip := range ips {
			if !public(ip) {
				return nil, errors.New("destination must be public")
			}
		}
		for _, ip := range ips {
			conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if err == nil {
				return conn, nil
			}
		}
		return nil, errors.New("destination unavailable")
	}
	return &http.Client{Transport: transport, Timeout: timeout, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		if _, err := URL(req.URL.String()); err != nil {
			return err
		}
		req.Header.Del("Cookie")
		return nil
	}}
}

// NewClient is intended for bounded metadata and image requests.
func NewClient() *http.Client { return newClient(25 * time.Second) }

// NewStreamingClient keeps the same public-network and redirect policy as
// NewClient but does not apply an end-to-end deadline to a media response.
// The request context still controls cancellation when the browser goes away.
func NewStreamingClient() *http.Client { return newClient(0) }
