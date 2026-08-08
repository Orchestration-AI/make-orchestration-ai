package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const DefaultBaseURL = "https://api.orchestration-ai.com"

type Client struct {
	baseURL      string
	clientID     string
	clientSecret string
	httpClient   *http.Client

	mu          sync.Mutex
	accessToken string
	expiresAt   time.Time
}

func New(baseURL, clientID, clientSecret string) *Client {
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	return &Client{
		baseURL:      strings.TrimRight(baseURL, "/"),
		clientID:     clientID,
		clientSecret: clientSecret,
		httpClient:   &http.Client{Timeout: 30 * time.Second},
	}
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   any    `json:"expires_in"`
	TokenType   string `json:"token_type"`
}

func (c *Client) ensureToken() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	// 30s buffer, same as the TS SDK
	if c.accessToken != "" && time.Now().Before(c.expiresAt.Add(-30*time.Second)) {
		return nil
	}

	tokenBody, _ := json.Marshal(map[string]string{
		"grant_type":    "client_credentials",
		"client_id":     c.clientID,
		"client_secret": c.clientSecret,
	})

	resp, err := c.httpClient.Post(
		c.baseURL+"/oauth/token",
		"application/json",
		bytes.NewReader(tokenBody),
	)
	if err != nil {
		return fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("token request returned %d: %s", resp.StatusCode, string(body))
	}

	var tr tokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil {
		return fmt.Errorf("failed to decode token response: %w", err)
	}

	expiresIn := 3600
	switch v := tr.ExpiresIn.(type) {
	case float64:
		expiresIn = int(v)
	case string:
		if n, err := strconv.Atoi(v); err == nil {
			expiresIn = n
		}
	}
	c.accessToken = tr.AccessToken
	c.expiresAt = time.Now().Add(time.Duration(expiresIn) * time.Second)
	return nil
}

func (c *Client) Do(method, path string, body any) (*http.Response, error) {
	if err := c.ensureToken(); err != nil {
		return nil, err
	}

	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(b)
	}

	req, err := http.NewRequest(method, c.baseURL+path, bodyReader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.accessToken)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	return c.httpClient.Do(req)
}

func (c *Client) DoSignedUpload(uploadURL string, body io.Reader, contentType string, maxSizeBytes int64) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodPut, uploadURL, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("x-goog-content-length-range", fmt.Sprintf("0,%d", maxSizeBytes))
	return c.httpClient.Do(req)
}

// DecodeResponse decodes a successful JSON response body into v.
func DecodeResponse(resp *http.Response, v any) error {
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}
	if v == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(v)
}
