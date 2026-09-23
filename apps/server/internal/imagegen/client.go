package imagegen

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type Generator interface {
	Generate(context.Context, string) (string, error)
	Download(context.Context, string) (io.ReadCloser, string, error)
}

type Client struct {
	endpoint string
	model    string
	apiKey   string
	http     *http.Client
}

func New(endpoint, model, apiKey string, client *http.Client) *Client {
	if client == nil {
		client = http.DefaultClient
	}
	return &Client{endpoint: strings.TrimRight(endpoint, "/"), model: model, apiKey: apiKey, http: client}
}

func (c *Client) Generate(ctx context.Context, prompt string) (string, error) {
	body := map[string]any{
		"model":      c.model,
		"input":      map[string]any{"messages": []any{map[string]any{"role": "user", "content": []any{map[string]any{"text": prompt}}}}},
		"parameters": map[string]any{"size": "1536*864", "n": 1, "prompt_extend": false, "watermark": false},
	}
	var response struct {
		Output struct {
			Choices []struct {
				Message struct {
					Content []struct {
						Image string `json:"image"`
					} `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		} `json:"output"`
	}
	if err := c.doJSON(ctx, http.MethodPost, c.endpoint+"/services/aigc/multimodal-generation/generation", body, &response); err != nil {
		return "", err
	}
	if len(response.Output.Choices) == 0 || len(response.Output.Choices[0].Message.Content) == 0 || response.Output.Choices[0].Message.Content[0].Image == "" {
		return "", errors.New("image provider returned no image")
	}
	return response.Output.Choices[0].Message.Content[0].Image, nil
}

func (c *Client) Download(ctx context.Context, rawURL string) (io.ReadCloser, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, "", err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		defer res.Body.Close()
		return nil, "", fmt.Errorf("image download returned %d", res.StatusCode)
	}
	return res.Body, res.Header.Get("Content-Type"), nil
}

func (c *Client) doJSON(ctx context.Context, method, url string, body any, output any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		return fmt.Errorf("image provider returned %d: %s", res.StatusCode, strings.TrimSpace(string(message)))
	}
	return json.NewDecoder(res.Body).Decode(output)
}
