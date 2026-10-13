// Package gdrive creates and looks up Google Drive folders as a dedicated
// Google Workspace user (a bot account that is a member of the company Shared
// Drive), authenticated with an OAuth refresh token. It talks to the token
// endpoint and Drive API v3 over plain HTTP so the server needs no Google SDK.
// Every call also targets Shared Drives (supportsAllDrives).
package gdrive

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	FolderMimeType = "application/vnd.google-apps.folder"

	defaultTokenURL = "https://oauth2.googleapis.com/token"
	defaultAPIBase  = "https://www.googleapis.com/drive/v3"

	// Refresh a little before Google's expiry so a request never starts with a
	// token that dies mid-flight.
	tokenRefreshMargin = 60 * time.Second
)

var (
	// ErrNotFound means the folder does not exist or the Drive account cannot
	// see it; Drive answers 404 for both.
	ErrNotFound = errors.New("drive folder not found or not shared with the drive account")
	// ErrNotFolder means the ID names a file, not a folder.
	ErrNotFolder = errors.New("drive item is not a folder")
	// ErrForbidden means the Drive account can see the item but not write.
	ErrForbidden = errors.New("drive account lacks permission on this drive folder")
	// ErrInvalidFolderID means the input is neither a folder link nor an ID.
	ErrInvalidFolderID = errors.New("not a Google Drive folder link or ID")
	// ErrRefreshTokenRevoked means Google answered invalid_grant: the refresh
	// token was revoked, expired, or issued for another OAuth client.
	ErrRefreshTokenRevoked = errors.New("google drive refresh token was revoked or expired; generate a new one")
)

// Folder is the subset of a Drive file the integration uses.
type Folder struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	MimeType string `json:"mimeType"`
}

// FolderURL is the browser link for a folder ID.
func FolderURL(id string) string {
	return "https://drive.google.com/drive/folders/" + id
}

// Config holds the OAuth client and the bot account's refresh token.
type Config struct {
	ClientID     string
	ClientSecret string
	RefreshToken string
}

// Client is safe for concurrent use.
type Client struct {
	cfg      Config
	http     *http.Client
	now      func() time.Time
	tokenURL string
	apiBase  string

	mu     sync.Mutex
	token  string
	expiry time.Time
	email  string
}

// Option adjusts a Client; tests use them to point at an httptest server.
type Option func(*Client)

// WithEndpoints overrides the token URL and Drive API base URL.
func WithEndpoints(tokenURL, apiBase string) Option {
	return func(c *Client) {
		c.tokenURL = tokenURL
		c.apiBase = strings.TrimRight(apiBase, "/")
	}
}

// WithHTTPClient replaces the HTTP client.
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// WithClock replaces time.Now, for token-expiry tests.
func WithClock(now func() time.Time) Option { return func(c *Client) { c.now = now } }

// New returns a client, or an error when a credential is missing.
func New(cfg Config, opts ...Option) (*Client, error) {
	cfg.ClientID = strings.TrimSpace(cfg.ClientID)
	cfg.ClientSecret = strings.TrimSpace(cfg.ClientSecret)
	cfg.RefreshToken = strings.TrimSpace(cfg.RefreshToken)
	switch {
	case cfg.RefreshToken == "":
		return nil, errors.New("google drive refresh token is empty")
	case cfg.ClientID == "" || cfg.ClientSecret == "":
		return nil, errors.New("google drive OAuth client id or secret is empty")
	}
	c := &Client{
		cfg:      cfg,
		http:     &http.Client{Timeout: 20 * time.Second},
		now:      time.Now,
		tokenURL: defaultTokenURL,
		apiBase:  defaultAPIBase,
	}
	for _, opt := range opts {
		opt(c)
	}
	return c, nil
}

var (
	folderPathPattern = regexp.MustCompile(`/folders/([A-Za-z0-9_-]+)`)
	rawIDPattern      = regexp.MustCompile(`^[A-Za-z0-9_-]{10,}$`)
)

// ParseFolderID accepts a folder link (…/drive/folders/<id>, …?id=<id>) or a
// bare folder ID and returns the ID.
func ParseFolderID(input string) (string, error) {
	s := strings.TrimSpace(input)
	if s == "" {
		return "", ErrInvalidFolderID
	}
	if m := folderPathPattern.FindStringSubmatch(s); m != nil {
		return m[1], nil
	}
	if u, err := url.Parse(s); err == nil && u.Host != "" {
		if id := u.Query().Get("id"); rawIDPattern.MatchString(id) {
			return id, nil
		}
		return "", ErrInvalidFolderID
	}
	if rawIDPattern.MatchString(s) {
		return s, nil
	}
	return "", ErrInvalidFolderID
}

// accessToken returns a cached access token, exchanging the refresh token for
// a new one when the cached one is about to expire.
func (c *Client) accessToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	if c.token != "" && now.Add(tokenRefreshMargin).Before(c.expiry) {
		return c.token, nil
	}
	form := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {c.cfg.RefreshToken},
		"client_id":     {c.cfg.ClientID},
		"client_secret": {c.cfg.ClientSecret},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("google token request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode != http.StatusOK {
		var oauthErr struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(body, &oauthErr) == nil && oauthErr.Error == "invalid_grant" {
			return "", ErrRefreshTokenRevoked
		}
		return "", fmt.Errorf("google token request returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tok); err != nil || tok.AccessToken == "" {
		return "", errors.New("google token response has no access_token")
	}
	if tok.ExpiresIn <= 0 {
		tok.ExpiresIn = 3600
	}
	c.token = tok.AccessToken
	c.expiry = now.Add(time.Duration(tok.ExpiresIn) * time.Second)
	return c.token, nil
}

// AccountEmail is the Drive account's address, for messages that ask an admin
// to share a folder with it. It is fetched once and cached; on failure it
// returns "" so callers fall back to generic wording.
func (c *Client) AccountEmail(ctx context.Context) string {
	c.mu.Lock()
	email := c.email
	c.mu.Unlock()
	if email != "" {
		return email
	}
	var about struct {
		User struct {
			EmailAddress string `json:"emailAddress"`
		} `json:"user"`
	}
	if err := c.do(ctx, http.MethodGet, "/about", url.Values{"fields": {"user(emailAddress)"}}, nil, &about); err != nil {
		return ""
	}
	c.mu.Lock()
	c.email = about.User.EmailAddress
	c.mu.Unlock()
	return about.User.EmailAddress
}

func (c *Client) do(ctx context.Context, method, path string, query url.Values, body any, out any) error {
	token, err := c.accessToken(ctx)
	if err != nil {
		return err
	}
	if query == nil {
		query = url.Values{}
	}
	if strings.HasPrefix(path, "/files") {
		query.Set("supportsAllDrives", "true")
	}
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = strings.NewReader(string(raw))
	}
	req, err := http.NewRequestWithContext(ctx, method, c.apiBase+path+"?"+query.Encode(), reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("drive request: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return ErrNotFound
	case resp.StatusCode == http.StatusForbidden:
		return ErrForbidden
	case resp.StatusCode < 200 || resp.StatusCode > 299:
		return fmt.Errorf("drive API returned %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			return fmt.Errorf("decode drive response: %w", err)
		}
	}
	return nil
}

// GetFolder returns the folder, or ErrNotFound / ErrNotFolder.
func (c *Client) GetFolder(ctx context.Context, id string) (Folder, error) {
	var f Folder
	err := c.do(ctx, http.MethodGet, "/files/"+url.PathEscape(id), url.Values{"fields": {"id,name,mimeType"}}, nil, &f)
	if err != nil {
		return Folder{}, err
	}
	if f.MimeType != FolderMimeType {
		return Folder{}, ErrNotFolder
	}
	return f, nil
}

// FindOrCreateFolder returns the child folder of parentID named name,
// creating it when none exists. Callers serialize concurrent calls for the
// same parent; Drive itself allows duplicate names.
func (c *Client) FindOrCreateFolder(ctx context.Context, parentID, name string) (Folder, error) {
	q := fmt.Sprintf("name = '%s' and '%s' in parents and mimeType = '%s' and trashed = false",
		escapeQuery(name), escapeQuery(parentID), FolderMimeType)
	var list struct {
		Files []Folder `json:"files"`
	}
	err := c.do(ctx, http.MethodGet, "/files", url.Values{
		"q":                         {q},
		"fields":                    {"files(id,name,mimeType)"},
		"includeItemsFromAllDrives": {"true"},
		"pageSize":                  {"10"},
	}, nil, &list)
	if err != nil {
		return Folder{}, err
	}
	if len(list.Files) > 0 {
		return list.Files[0], nil
	}
	var created Folder
	err = c.do(ctx, http.MethodPost, "/files", url.Values{"fields": {"id,name,mimeType"}}, map[string]any{
		"name":     name,
		"mimeType": FolderMimeType,
		"parents":  []string{parentID},
	}, &created)
	if err != nil {
		return Folder{}, err
	}
	return created, nil
}

// escapeQuery escapes a value for a Drive search string literal.
func escapeQuery(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, `\`, `\\`), `'`, `\'`)
}
