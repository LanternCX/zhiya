package domain

import (
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/jpeg"
	"image/png"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

const (
	PasswordMinCharacters  = 8
	PasswordMaxBytes       = 256
	NicknameMaxCharacters  = 40
	DefaultNickname        = "学习者"
	AvatarMaxBytes         = 2 * 1024 * 1024
	AvatarMaxDimension     = 2048
	VerificationCodeDigits = 8
)

const VerificationTTL = 10 * time.Minute

type ValidationError string

func (e ValidationError) Error() string { return string(e) }

type User struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	Nickname     string `json:"nickname"`
	Avatar       string `json:"avatar"`
	PasswordHash string `json:"-"`
}

func (u User) PasswordMatches(password string) bool {
	parts := strings.Split(u.PasswordHash, "$")
	if len(parts) != 4 || parts[0] != "argon2id" || parts[1] != "19m2t1p" {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, 2, 19*1024, 1, 32)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func HashPassword(password string) string {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		panic(err)
	}
	hash := argon2.IDKey([]byte(password), salt, 2, 19*1024, 1, 32)
	return "argon2id$19m2t1p$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(hash)
}

func ValidatePassword(password string) error {
	if utf8.RuneCountInString(password) < PasswordMinCharacters {
		return ValidationError(fmt.Sprintf("密码至少需要 %d 个字符", PasswordMinCharacters))
	}
	if len(password) > PasswordMaxBytes {
		return ValidationError("密码太长，请缩短后重试")
	}
	return nil
}

func NormalizeEmail(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	address, err := mail.ParseAddress(value)
	if err != nil || address.Address != value || len(value) > 254 || !strings.Contains(value, ".") {
		return "", ValidationError("请输入有效的邮箱地址")
	}
	return value, nil
}

func ValidateNickname(value string) (string, error) {
	value = strings.TrimSpace(value)
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) < 1 || utf8.RuneCountInString(value) > NicknameMaxCharacters {
		return "", ValidationError(fmt.Sprintf("昵称需为 1–%d 个字符", NicknameMaxCharacters))
	}
	return value, nil
}

func DecodeAvatar(value string) ([]byte, error) {
	if value == "" {
		return nil, nil
	}
	fail := ValidationError(fmt.Sprintf("头像仅支持 %g MB 以内、边长不超过 %d 像素的 PNG 或 JPEG 图片", float64(AvatarMaxBytes)/(1024*1024), AvatarMaxDimension))
	parts := strings.SplitN(value, ",", 2)
	if len(parts) != 2 || (parts[0] != "data:image/png;base64" && parts[0] != "data:image/jpeg;base64") {
		return nil, fail
	}
	raw, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil || len(raw) > AvatarMaxBytes {
		return nil, fail
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "png" && format != "jpeg") || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > AvatarMaxDimension || cfg.Height > AvatarMaxDimension {
		return nil, fail
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, fail
	}
	var output bytes.Buffer
	if err = png.Encode(&output, img); err != nil || output.Len() > AvatarMaxBytes {
		return nil, fail
	}
	return output.Bytes(), nil
}
