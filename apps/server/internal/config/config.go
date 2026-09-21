// Package config loads the server's configuration once, before opening external connections.
package config

import (
	"bytes"
	"fmt"
	"io"
	"net"
	"net/mail"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"
)

type Config struct {
	Model       Model    `yaml:"model"`
	Speech      Speech   `yaml:"speech"`
	Runner      Runner   `yaml:"runner"`
	Development bool     `yaml:"development"`
	Server      Server   `yaml:"http"`
	Database    Database `yaml:"database"`
	Storage     Storage  `yaml:"storage"`
	SMTP        SMTP     `yaml:"smtp"`
	Account     Account  `yaml:"account"`
}
type Speech struct {
	Endpoint  string `yaml:"endpoint"`
	ASRAPIKey string `yaml:"asr_api_key"`
	TTSAPIKey string `yaml:"tts_api_key"`
	ASRModel  string `yaml:"asr_model"`
	TTSModel  string `yaml:"tts_model"`
	TTSVoice  string `yaml:"tts_voice"`
}
type Runner struct {
	Endpoint string `yaml:"endpoint"`
}
type Model struct {
	Endpoint string `yaml:"endpoint"`
	ID       string `yaml:"id"`
	APIKey   string `yaml:"api_key"`
}
type Server struct {
	Listen                   string `yaml:"listen"`
	Origin                   string `yaml:"origin"`
	WebDir                   string `yaml:"web_dir"`
	StartupTimeoutSeconds    int    `yaml:"startup_timeout_seconds"`
	ShutdownTimeoutSeconds   int    `yaml:"shutdown_timeout_seconds"`
	ReadHeaderTimeoutSeconds int    `yaml:"read_header_timeout_seconds"`
	ReadTimeoutSeconds       int    `yaml:"read_timeout_seconds"`
	WriteTimeoutSeconds      int    `yaml:"write_timeout_seconds"`
	IdleTimeoutSeconds       int    `yaml:"idle_timeout_seconds"`
	RequestTimeoutSeconds    int    `yaml:"request_timeout_seconds"`
	CleanupIntervalSeconds   int    `yaml:"cleanup_interval_seconds"`
	MaxBodyBytes             int    `yaml:"max_body_bytes"`
}
type Database struct {
	URL string `yaml:"url"`
}
type Storage struct {
	Endpoint       string `yaml:"endpoint"`
	PublicEndpoint string `yaml:"public_endpoint"`
	Region         string `yaml:"region"`
	Bucket         string `yaml:"bucket"`
	AccessKey      string `yaml:"access_key"`
	SecretKey      string `yaml:"secret_key"`
	URLTTLSeconds  int    `yaml:"url_ttl_seconds"`
}
type SMTP struct {
	Address        string `yaml:"address"`
	From           string `yaml:"from"`
	Username       string `yaml:"username"`
	Password       string `yaml:"password"`
	TimeoutSeconds int    `yaml:"timeout_seconds"`
}
type Account struct {
	SessionTTLSeconds    int `yaml:"session_ttl_seconds"`
	VerificationAttempts int `yaml:"verification_attempts"`
	RateWindowSeconds    int `yaml:"rate_window_seconds"`
	IPLimit              int `yaml:"ip_limit"`
	MailLimit            int `yaml:"mail_limit"`
	LoginLimit           int `yaml:"login_limit"`
	EmailChangeLimit     int `yaml:"email_change_limit"`
}

func Seconds(n int) time.Duration { return time.Duration(n) * time.Second }

// Load applies ZHIYA_SERVER_SECTION_KEY environment variables over the selected file.
// Empty environment values are overrides too, so optional credentials can be cleared.
func Load(path string) (Config, error) {
	return loadFiles(path, "")
}

// LoadDefault overlays optional local fields before applying environment overrides.
func LoadDefault(dir string) (Config, error) {
	return loadFiles(filepath.Join(dir, "config.yaml"), filepath.Join(dir, "config.local.yaml"))
}

func decodeFile(path string, cfg *Config) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	decoder := yaml.NewDecoder(bytes.NewReader(raw))
	decoder.KnownFields(true)
	if err = decoder.Decode(cfg); err != nil {
		if err == io.EOF {
			return nil
		}
		return fmt.Errorf("invalid configuration YAML: check field names and value types")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return fmt.Errorf("configuration must contain one YAML document")
	}
	var document yaml.Node
	if err = yaml.Unmarshal(raw, &document); err != nil || !validScalars(&document) {
		return fmt.Errorf("configuration does not accept fractional or null values; quote text values")
	}
	return nil
}

func loadFiles(path, local string) (Config, error) {
	var cfg Config
	err := decodeFile(path, &cfg)
	if err != nil {
		return Config{}, fmt.Errorf("cannot load default or selected configuration: %w", err)
	}
	if local != "" {
		err = decodeFile(local, &cfg)
		if err != nil && !os.IsNotExist(err) {
			return Config{}, fmt.Errorf("cannot load local configuration: %w", err)
		}
	}
	known := map[string]bool{"ZHIYA_SERVER_CONFIG": true}
	if err = override(reflect.ValueOf(&cfg).Elem(), "ZHIYA_SERVER", known); err != nil {
		return Config{}, err
	}
	for _, entry := range os.Environ() {
		name, _, _ := strings.Cut(entry, "=")
		if strings.HasPrefix(name, "ZHIYA_SERVER_") && !known[name] {
			return Config{}, fmt.Errorf("unknown configuration environment variable %s", name)
		}
	}
	if err = cfg.Validate(); err != nil {
		return Config{}, err
	}
	if !filepath.IsAbs(cfg.Server.WebDir) {
		cfg.Server.WebDir = filepath.Join(filepath.Dir(path), cfg.Server.WebDir)
	}
	cfg.Server.WebDir, err = filepath.Abs(cfg.Server.WebDir)
	if err != nil {
		return Config{}, fmt.Errorf("cannot resolve http.web_dir")
	}
	absoluteConfig, err := filepath.Abs(path)
	if err != nil {
		return Config{}, fmt.Errorf("cannot resolve configuration path")
	}
	relative, err := filepath.Rel(cfg.Server.WebDir, absoluteConfig)
	if err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return Config{}, fmt.Errorf("configuration file must be outside http.web_dir")
	}
	return cfg, nil
}

func validScalars(node *yaml.Node) bool {
	if node.Tag == "!!float" || node.Tag == "!!null" {
		return false
	}
	for _, child := range node.Content {
		if !validScalars(child) {
			return false
		}
	}
	return true
}

func override(value reflect.Value, prefix string, known map[string]bool) error {
	typ := value.Type()
	for i := 0; i < value.NumField(); i++ {
		field := value.Field(i)
		name := prefix + "_" + strings.ToUpper(typ.Field(i).Tag.Get("yaml"))
		if field.Kind() == reflect.Struct {
			if err := override(field, name, known); err != nil {
				return err
			}
			continue
		}
		known[name] = true
		raw, exists := os.LookupEnv(name)
		if !exists {
			continue
		}
		switch field.Kind() {
		case reflect.String:
			field.SetString(raw)
		case reflect.Bool:
			if raw != "true" && raw != "false" {
				return fmt.Errorf("%s must be true or false", name)
			}
			field.SetBool(raw == "true")
		case reflect.Int:
			n, err := strconv.ParseInt(raw, 10, 32)
			if err != nil {
				return fmt.Errorf("%s must be an integer", name)
			}
			field.SetInt(n)
		}
	}
	return nil
}

func (c Config) Validate() error {
	if c.Speech.Endpoint != "" {
		u, err := url.Parse(c.Speech.Endpoint)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "wss" && !(c.Development && u.Scheme == "ws" && loopback(u.Hostname()))) {
			return fmt.Errorf("speech.endpoint must be a secure WebSocket URL (loopback WS allowed in development)")
		}
		if c.Speech.ASRModel == "" || c.Speech.TTSModel == "" || c.Speech.TTSVoice == "" {
			return fmt.Errorf("speech models and voice are required when speech.endpoint is configured")
		}
	}
	if c.Model.Endpoint != "" {
		u, err := url.Parse(c.Model.Endpoint)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && !(c.Development && u.Scheme == "http" && loopback(u.Hostname()))) {
			return fmt.Errorf("model.endpoint must be an HTTPS URL (loopback HTTP allowed in development)")
		}
		if c.Model.ID == "" {
			return fmt.Errorf("model.id is required when model.endpoint is configured")
		}
	}
	runner, err := url.Parse(c.Runner.Endpoint)
	if err != nil || runner.Host == "" || runner.User != nil || runner.RawQuery != "" || runner.Fragment != "" || (runner.Scheme != "http" && runner.Scheme != "https") {
		return fmt.Errorf("runner.endpoint must be an HTTP(S) URL")
	}
	// All numeric settings are positive and bounded to avoid duration/size overflow.
	if err := positive(reflect.ValueOf(c), ""); err != nil {
		return err
	}
	if !address(c.Server.Listen) {
		return fmt.Errorf("http.listen must be a host:port address")
	}
	if !address(c.SMTP.Address) {
		return fmt.Errorf("smtp.address must be a host:port address")
	}

	origin, err := url.Parse(c.Server.Origin)
	if err != nil || origin.Host == "" || origin.Path != "" || origin.RawQuery != "" || origin.ForceQuery || origin.Fragment != "" || origin.User != nil ||
		(origin.Scheme != "http" && origin.Scheme != "https") {
		return fmt.Errorf("http.origin must be an HTTP(S) origin without a path")
	}
	if !c.Development && origin.Scheme != "https" {
		return fmt.Errorf("http.origin must use HTTPS in production")
	}
	if c.Development && origin.Scheme != "http" {
		return fmt.Errorf("development http.origin must use HTTP")
	}
	if port := origin.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return fmt.Errorf("http.origin has an invalid port")
		}
	}
	if c.Development && !loopback(origin.Hostname()) {
		return fmt.Errorf("development http.origin must use loopback")
	}
	if c.Development {
		host, _, _ := net.SplitHostPort(c.Server.Listen)
		if !loopback(host) {
			return fmt.Errorf("development http.listen must use loopback")
		}
		host, _, _ = net.SplitHostPort(c.SMTP.Address)
		if !loopback(host) {
			return fmt.Errorf("development SMTP must use loopback")
		}
	}
	if strings.TrimSpace(c.Server.WebDir) == "" {
		return fmt.Errorf("http.web_dir is required")
	}
	db, err := url.Parse(c.Database.URL)
	if err != nil || db.Hostname() == "" || (db.Scheme != "postgres" && db.Scheme != "postgresql") || db.Path == "" || db.Path == "/" {
		return fmt.Errorf("database.url must be a PostgreSQL connection URL")
	}
	storage, err := url.Parse(c.Storage.Endpoint)
	if err != nil || storage.Host == "" || storage.User != nil || storage.RawQuery != "" || storage.Fragment != "" || (storage.Scheme != "https" && !(c.Development && storage.Scheme == "http" && loopback(storage.Hostname()))) {
		return fmt.Errorf("storage.endpoint must be an HTTPS URL (loopback HTTP allowed in development)")
	}
	publicStorage, err := url.Parse(c.Storage.PublicEndpoint)
	if err != nil || publicStorage.Host == "" || publicStorage.User != nil || publicStorage.RawQuery != "" || publicStorage.Fragment != "" || (publicStorage.Scheme != "https" && !(c.Development && publicStorage.Scheme == "http" && loopback(publicStorage.Hostname()))) {
		return fmt.Errorf("storage.public_endpoint must be an HTTPS URL (loopback HTTP allowed in development)")
	}
	if strings.TrimSpace(c.Storage.Region) == "" || strings.TrimSpace(c.Storage.Bucket) == "" || strings.TrimSpace(c.Storage.AccessKey) == "" || strings.TrimSpace(c.Storage.SecretKey) == "" {
		return fmt.Errorf("storage region, bucket, access_key and secret_key are required")
	}
	if port := db.Port(); port != "" {
		if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
			return fmt.Errorf("database.url has an invalid port")
		}
	}
	if _, err := mail.ParseAddress(c.SMTP.From); err != nil || strings.ContainsAny(c.SMTP.From, "\r\n") {
		return fmt.Errorf("smtp.from must be a valid sender")
	}
	if (c.SMTP.Username == "") != (c.SMTP.Password == "") {
		return fmt.Errorf("smtp.username and smtp.password must both be set or both be empty")
	}
	if c.Server.ReadHeaderTimeoutSeconds > c.Server.ReadTimeoutSeconds {
		return fmt.Errorf("http.read_timeout_seconds must cover read_header_timeout_seconds")
	}
	if c.Server.WriteTimeoutSeconds <= c.Server.RequestTimeoutSeconds {
		return fmt.Errorf("http.write_timeout_seconds must exceed request_timeout_seconds")
	}

	if c.SMTP.TimeoutSeconds*2 > c.Server.RequestTimeoutSeconds {
		return fmt.Errorf("http.request_timeout_seconds must cover two SMTP deliveries")
	}
	return nil
}

func positive(value reflect.Value, prefix string) error {
	typ := value.Type()
	for i := 0; i < value.NumField(); i++ {
		name := typ.Field(i).Tag.Get("yaml")
		if prefix != "" {
			name = prefix + "." + name
		}
		field := value.Field(i)
		if field.Kind() == reflect.Struct {
			if err := positive(field, name); err != nil {
				return err
			}
		}
		if field.Kind() == reflect.Int && (field.Int() < 1 || field.Int() > 2147483647) {
			return fmt.Errorf("%s must be between 1 and 2147483647", name)
		}
	}
	return nil
}
func address(value string) bool {
	host, port, err := net.SplitHostPort(value)
	if err != nil || host == "" {
		return false
	}
	n, err := strconv.Atoi(port)
	return err == nil && n > 0 && n <= 65535
}
func loopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
