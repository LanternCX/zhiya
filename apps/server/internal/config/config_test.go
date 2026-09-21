package config_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
)

func TestDefaultConfigurationLayersLocalFields(t *testing.T) {
	raw, err := os.ReadFile("../../config.yaml")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "config.yaml"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	base, err := config.LoadDefault(dir)
	if err != nil {
		t.Fatal(err)
	}
	local := filepath.Join(dir, "config.local.yaml")
	if err := os.WriteFile(local, []byte("http:\n  listen: 127.0.0.1:18081\nmodel:\n  id: gpt-5.6-luna\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.LoadDefault(dir)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Server.Listen != "127.0.0.1:18081" || cfg.Model.ID != "gpt-5.6-luna" || cfg.Server.Origin != base.Server.Origin || cfg.Database.URL != base.Database.URL {
		t.Fatal("local fields must override while absent fields retain defaults")
	}
	t.Setenv("ZHIYA_SERVER_MODEL_ID", "")
	cfg, err = config.LoadDefault(dir)
	if err != nil || cfg.Model.ID != "" {
		t.Fatal("environment must override local values, including empty values")
	}
	explicit, err := config.Load(filepath.Join(dir, "config.yaml"))
	if err != nil || explicit.Server.Listen != base.Server.Listen {
		t.Fatal("explicit configuration must not load a local overlay")
	}
	for _, content := range []string{"http:\n  listen: null\n", "http:\n  typo: secret-value\n", "http:\n  read_timeout_seconds: 0\n"} {
		if err := os.WriteFile(local, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := config.LoadDefault(dir); err == nil || strings.Contains(err.Error(), "secret-value") {
			t.Fatal("invalid local configuration must fail without exposing values")
		}
	}
}

func TestEnvironmentOverridesFileAndPathsBelongToConfigDirectory(t *testing.T) {
	raw, err := os.ReadFile("../../config.yaml")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ZHIYA_SERVER_HTTP_LISTEN", "127.0.0.1:18080")
	t.Setenv("ZHIYA_SERVER_ACCOUNT_SESSION_TTL_SECONDS", "120")
	t.Setenv("ZHIYA_SERVER_SMTP_PASSWORD", "private-test-value")
	t.Setenv("ZHIYA_SERVER_SMTP_USERNAME", "test-user")
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Server.Listen != "127.0.0.1:18080" || cfg.Account.SessionTTLSeconds != 120 || cfg.SMTP.Password != "private-test-value" {
		t.Fatal("environment overrides were not applied")
	}
	if cfg.Server.WebDir != filepath.Join(dir, "../client/dist") {
		t.Fatal("web_dir must be relative to the configuration file")
	}
}

func TestSpeechCredentialsAreConfiguredIndependently(t *testing.T) {
	t.Setenv("ZHIYA_SERVER_SPEECH_ASR_API_KEY", "asr-secret")
	t.Setenv("ZHIYA_SERVER_SPEECH_TTS_API_KEY", "tts-secret")
	cfg, err := config.Load("../../config.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Speech.ASRAPIKey != "asr-secret" || cfg.Speech.TTSAPIKey != "tts-secret" {
		t.Fatalf("speech credentials were not separated: %#v", cfg.Speech)
	}
}

func TestInvalidConfigurationFailsWithoutLeakingSecrets(t *testing.T) {
	for _, tc := range []struct{ name, value string }{
		{"ZHIYA_SERVER_HTTP_REQUEST_TIMEOUT_SECONDS", "0"},
		{"ZHIYA_SERVER_ACCOUNT_SESSION_TTL_SECONDS", "-1"},
		{"ZHIYA_SERVER_ACCOUNT_VERIFICATION_ATTEMPTS", "1.5"},
		{"ZHIYA_SERVER_HTTP_ORIGIN", "ftp://example.com"},
		{"ZHIYA_SERVER_DATABASE_URL", "postgres://secret-value@[bad"},
		{"ZHIYA_SERVER_STORAGE_ENDPOINT", "http://storage.example.com"},
		{"ZHIYA_SERVER_STORAGE_SECRET_KEY", ""},
		{"ZHIYA_SERVER_DEVELOPMENT", "false"},
		{"ZHIYA_SERVER_SMTP_ADDRESS", "localhost:70000"},
		{"ZHIYA_SERVER_ACCOUNT_RATE_WINDOW_SECONDS", "2147483648"},
		{"ZHIYA_SERVER_HTTP_LISTENN", "127.0.0.1:9000"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(tc.name, tc.value)
			_, err := config.Load("../../config.yaml")
			if err == nil {
				t.Fatal("invalid configuration accepted")
			}
			if strings.Contains(err.Error(), "secret-value") {
				t.Fatal("configuration error leaked credentials")
			}
		})
	}
}

func TestUnknownFieldsAndMultipleYAMLDocumentsAreRejected(t *testing.T) {
	raw, err := os.ReadFile("../../config.yaml")
	if err != nil {
		t.Fatal(err)
	}
	for _, content := range []string{
		strings.Replace(string(raw), "listen:", "listenn:", 1),
		string(raw) + "\n---\nhttp: {}",
		string(raw) + "\nrules:\n  password_min_characters: 5\n",
		strings.Replace(string(raw), "ip_limit: 60", "ip_limit: 1.5", 1),
	} {
		path := filepath.Join(t.TempDir(), "config.yaml")
		if err = os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err = config.Load(path); err == nil {
			t.Fatal("invalid YAML configuration accepted")
		}
	}
}

func TestConfigurationCannotBeServedAsAStaticAsset(t *testing.T) {
	t.Setenv("ZHIYA_SERVER_HTTP_WEB_DIR", ".")
	if _, err := config.Load("../../config.yaml"); err == nil {
		t.Fatal("configuration inside static file root was accepted")
	}
}
