package gdrive_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/integrations/gdrive"
	"github.com/multica-ai/multica/server/internal/integrations/gdrive/gdrivetest"
)

func TestParseFolderID(t *testing.T) {
	const id = "1AbC_dEf-GhIjKlMnOp"
	for _, in := range []string{
		id,
		"  " + id + "  ",
		"https://drive.google.com/drive/folders/" + id,
		"https://drive.google.com/drive/u/0/folders/" + id + "?usp=sharing",
		"https://drive.google.com/open?id=" + id,
	} {
		got, err := gdrive.ParseFolderID(in)
		if err != nil || got != id {
			t.Errorf("ParseFolderID(%q) = %q, %v; want %q", in, got, err, id)
		}
	}
	for _, in := range []string{"", "short", "https://example.com/page", "not a folder id!"} {
		if _, err := gdrive.ParseFolderID(in); !errors.Is(err, gdrive.ErrInvalidFolderID) {
			t.Errorf("ParseFolderID(%q) err = %v; want ErrInvalidFolderID", in, err)
		}
	}
}

func TestNewRequiresAllCredentials(t *testing.T) {
	full := gdrive.Config{ClientID: "id", ClientSecret: "secret", RefreshToken: "refresh"}
	if _, err := gdrive.New(full); err != nil {
		t.Fatalf("complete config: %v", err)
	}
	for name, cfg := range map[string]gdrive.Config{
		"no refresh token": {ClientID: "id", ClientSecret: "secret"},
		"no client id":     {ClientSecret: "secret", RefreshToken: "refresh"},
		"no secret":        {ClientID: "id", RefreshToken: "refresh"},
		"blank token":      {ClientID: "id", ClientSecret: "secret", RefreshToken: "   "},
	} {
		if _, err := gdrive.New(cfg); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestRevokedRefreshTokenIsReported(t *testing.T) {
	fake := gdrivetest.New(t)
	fake.AddFolder("rootFolder0001", "02-Blum", "")
	fake.RevokeRefreshToken = true
	client := fake.Client(t)
	if _, err := client.GetFolder(context.Background(), "rootFolder0001"); !errors.Is(err, gdrive.ErrRefreshTokenRevoked) {
		t.Fatalf("err = %v, want ErrRefreshTokenRevoked", err)
	}
}

func TestAccountEmailIsCached(t *testing.T) {
	fake := gdrivetest.New(t)
	client := fake.Client(t)
	ctx := context.Background()
	if got := client.AccountEmail(ctx); got != gdrivetest.AccountEmail {
		t.Fatalf("AccountEmail = %q, want %q", got, gdrivetest.AccountEmail)
	}
	if got := client.AccountEmail(ctx); got != gdrivetest.AccountEmail || fake.TokenCalls != 1 {
		t.Fatalf("second AccountEmail = %q, token calls %d", got, fake.TokenCalls)
	}
}

func TestAccessTokenIsCachedUntilNearExpiry(t *testing.T) {
	fake := gdrivetest.New(t)
	fake.AddFolder("rootFolder0001", "02-Blum", "")
	now := time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC)
	client := fake.Client(t, gdrive.WithClock(func() time.Time { return now }))
	ctx := context.Background()

	for range 3 {
		if _, err := client.GetFolder(ctx, "rootFolder0001"); err != nil {
			t.Fatalf("GetFolder: %v", err)
		}
	}
	if fake.TokenCalls != 1 {
		t.Fatalf("token calls = %d, want 1 while the token is fresh", fake.TokenCalls)
	}
	now = now.Add(59*time.Minute + 30*time.Second) // inside the refresh margin
	if _, err := client.GetFolder(ctx, "rootFolder0001"); err != nil {
		t.Fatalf("GetFolder: %v", err)
	}
	if fake.TokenCalls != 2 {
		t.Fatalf("token calls = %d, want 2 after the token nears expiry", fake.TokenCalls)
	}
}

func TestGetFolderErrors(t *testing.T) {
	fake := gdrivetest.New(t)
	fake.AddFile("someFile00001", "notes.txt", "")
	client := fake.Client(t)
	ctx := context.Background()
	if _, err := client.GetFolder(ctx, "missingFolder01"); !errors.Is(err, gdrive.ErrNotFound) {
		t.Errorf("missing: err = %v, want ErrNotFound", err)
	}
	if _, err := client.GetFolder(ctx, "someFile00001"); !errors.Is(err, gdrive.ErrNotFolder) {
		t.Errorf("file: err = %v, want ErrNotFolder", err)
	}
}

func TestFindOrCreateFolderReusesExisting(t *testing.T) {
	fake := gdrivetest.New(t)
	fake.AddFolder("projectFolder01", "02-Blum", "")
	client := fake.Client(t)
	ctx := context.Background()

	first, err := client.FindOrCreateFolder(ctx, "projectFolder01", "Resources")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	second, err := client.FindOrCreateFolder(ctx, "projectFolder01", "Resources")
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if first.ID != second.ID || fake.CreateCalls != 1 {
		t.Fatalf("second call created again: %q vs %q, creates=%d", first.ID, second.ID, fake.CreateCalls)
	}
	// Names with quotes must be escaped in the search query.
	quoted, err := client.FindOrCreateFolder(ctx, "projectFolder01", "Client's files")
	if err != nil {
		t.Fatalf("quoted create: %v", err)
	}
	again, err := client.FindOrCreateFolder(ctx, "projectFolder01", "Client's files")
	if err != nil || again.ID != quoted.ID {
		t.Fatalf("quoted find = %q, %v; want %q", again.ID, err, quoted.ID)
	}
}

func TestFindOrCreateFolderForbidden(t *testing.T) {
	fake := gdrivetest.New(t)
	fake.AddFolder("readOnlyFolder1", "02-Blum", "")
	fake.Forbidden["readOnlyFolder1"] = true
	client := fake.Client(t)
	if _, err := client.FindOrCreateFolder(context.Background(), "readOnlyFolder1", "Resources"); !errors.Is(err, gdrive.ErrForbidden) {
		t.Fatalf("err = %v, want ErrForbidden", err)
	}
}
