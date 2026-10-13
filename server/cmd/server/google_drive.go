package main

import (
	"log/slog"
	"os"
	"strings"

	"github.com/multica-ai/multica/server/internal/integrations/gdrive"
)

// googleDriveClientFromEnv builds the Drive client for the bot account whose
// refresh token is in GOOGLE_DRIVE_REFRESH_TOKEN. The OAuth client falls back
// to the login client (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Missing
// credentials leave the integration off rather than failing startup.
func googleDriveClientFromEnv() *gdrive.Client {
	cfg := gdrive.Config{
		ClientID:     firstNonEmptyEnv("GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_CLIENT_ID"),
		ClientSecret: firstNonEmptyEnv("GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"),
		RefreshToken: os.Getenv("GOOGLE_DRIVE_REFRESH_TOKEN"),
	}
	if strings.TrimSpace(cfg.RefreshToken) == "" {
		slog.Info("google drive integration disabled (GOOGLE_DRIVE_REFRESH_TOKEN not set)")
		return nil
	}
	client, err := gdrive.New(cfg)
	if err != nil {
		slog.Error("google drive integration disabled: set GOOGLE_DRIVE_CLIENT_ID/SECRET or GOOGLE_CLIENT_ID/SECRET", "error", err)
		return nil
	}
	slog.Info("google drive integration enabled")
	return client
}

func firstNonEmptyEnv(keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}
