// Package gdrivetest serves an in-memory Google token endpoint and the slice
// of Drive API v3 that package gdrive uses, for tests.
package gdrivetest

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/integrations/gdrive"
)

// Server is a fake Drive. Items are keyed by ID.
type Server struct {
	*httptest.Server
	mu          sync.Mutex
	items       map[string]item
	nextID      int
	TokenCalls  int
	CreateCalls int
	// Forbidden lists IDs the Drive account can see but not write.
	Forbidden map[string]bool
	// RevokeRefreshToken makes the token endpoint answer invalid_grant.
	RevokeRefreshToken bool
}

// Credentials the fake token endpoint accepts.
const (
	ClientID     = "test-client.apps.googleusercontent.com"
	ClientSecret = "test-secret"
	RefreshToken = "test-refresh-token"
	AccountEmail = "drive-bot@ikigaia.vn"
)

type item struct {
	gdrive.Folder
	Parent string
}

// New starts a fake Drive and registers its shutdown with t.
func New(t testing.TB) *Server {
	s := &Server{items: map[string]item{}, Forbidden: map[string]bool{}}
	s.Server = httptest.NewServer(http.HandlerFunc(s.serve))
	t.Cleanup(s.Close)
	return s
}

// TokenURL and APIBase are the endpoints to pass to gdrive.WithEndpoints.
func (s *Server) TokenURL() string { return s.URL + "/token" }
func (s *Server) APIBase() string  { return s.URL + "/drive/v3" }

// AddFolder seeds a folder; parent may be empty for a root.
func (s *Server) AddFolder(id, name, parent string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[id] = item{Folder: gdrive.Folder{ID: id, Name: name, MimeType: gdrive.FolderMimeType}, Parent: parent}
}

// AddFile seeds a non-folder item.
func (s *Server) AddFile(id, name, parent string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[id] = item{Folder: gdrive.Folder{ID: id, Name: name, MimeType: "text/plain"}, Parent: parent}
}

// Children lists folder names directly under parent.
func (s *Server) Children(parent string) []gdrive.Folder {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []gdrive.Folder
	for _, it := range s.items {
		if it.Parent == parent {
			out = append(out, it.Folder)
		}
	}
	return out
}

// Client returns a gdrive client wired to this server.
func (s *Server) Client(t testing.TB, opts ...gdrive.Option) *gdrive.Client {
	t.Helper()
	opts = append([]gdrive.Option{gdrive.WithEndpoints(s.TokenURL(), s.APIBase())}, opts...)
	c, err := gdrive.New(gdrive.Config{ClientID: ClientID, ClientSecret: ClientSecret, RefreshToken: RefreshToken}, opts...)
	if err != nil {
		t.Fatalf("gdrive client: %v", err)
	}
	return c
}

var (
	nameRe   = regexp.MustCompile(`name = '((?:[^'\\]|\\.)*)'`)
	parentRe = regexp.MustCompile(`'((?:[^'\\]|\\.)*)' in parents`)
)

func unescape(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, `\'`, `'`), `\\`, `\`)
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case r.URL.Path == "/token":
		s.TokenCalls++
		if err := r.ParseForm(); err != nil {
			http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
			return
		}
		f := r.PostForm
		if s.RevokeRefreshToken || f.Get("grant_type") != "refresh_token" || f.Get("refresh_token") != RefreshToken ||
			f.Get("client_id") != ClientID || f.Get("client_secret") != ClientSecret {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"Token has been expired or revoked."}`))
			return
		}
		writeJSON(w, map[string]any{"access_token": fmt.Sprintf("tok-%d", s.TokenCalls), "expires_in": 3600, "token_type": "Bearer"})
		return
	case !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer tok-"):
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/drive/v3")
	if strings.HasPrefix(path, "/files") && r.URL.Query().Get("supportsAllDrives") != "true" {
		http.Error(w, "supportsAllDrives missing", http.StatusBadRequest)
		return
	}
	switch {
	case r.Method == http.MethodGet && path == "/about":
		writeJSON(w, map[string]any{"user": map[string]any{"emailAddress": AccountEmail}})
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/files/"):
		it, ok := s.items[strings.TrimPrefix(path, "/files/")]
		if !ok {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		writeJSON(w, it.Folder)
	case r.Method == http.MethodGet && path == "/files":
		q := r.URL.Query().Get("q")
		nm, pm := nameRe.FindStringSubmatch(q), parentRe.FindStringSubmatch(q)
		files := []gdrive.Folder{}
		if nm != nil && pm != nil {
			for _, it := range s.items {
				if it.Parent == unescape(pm[1]) && it.Name == unescape(nm[1]) && it.MimeType == gdrive.FolderMimeType {
					files = append(files, it.Folder)
				}
			}
		}
		writeJSON(w, map[string]any{"files": files})
	case r.Method == http.MethodPost && path == "/files":
		var body struct {
			Name     string   `json:"name"`
			MimeType string   `json:"mimeType"`
			Parents  []string `json:"parents"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Parents) != 1 {
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		parent := body.Parents[0]
		if s.Forbidden[parent] {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if _, ok := s.items[parent]; !ok {
			http.Error(w, "parent not found", http.StatusNotFound)
			return
		}
		s.CreateCalls++
		s.nextID++
		id := fmt.Sprintf("created%04d-%d", s.nextID, time.Now().UnixNano()%1000)
		s.items[id] = item{Folder: gdrive.Folder{ID: id, Name: body.Name, MimeType: body.MimeType}, Parent: parent}
		writeJSON(w, s.items[id].Folder)
	default:
		http.Error(w, "unexpected "+r.Method+" "+path, http.StatusNotImplemented)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
