package resources

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/make-orchestration-ai/terraform-provider-orchestration-ai/internal/client"
)

type StorageFileResource struct{ client *client.Client }

type storageFileModel struct {
	ID              types.String `tfsdk:"id"`
	Scope           types.String `tfsdk:"scope"`
	WorkspaceID     types.String `tfsdk:"workspace_id"`
	OrchestrationID types.String `tfsdk:"orchestration_id"`
	AgentID         types.String `tfsdk:"agent_id"`
	LayerID         types.String `tfsdk:"layer_id"`
	Path            types.String `tfsdk:"path"`
	Content         types.String `tfsdk:"content"`
	SourcePath      types.String `tfsdk:"source_path"`
	SourceHash      types.String `tfsdk:"source_hash"`
}

func NewStorageFileResource() resource.Resource { return &StorageFileResource{} }

func (r *StorageFileResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_storage_file"
}

func (r *StorageFileResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":               schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"scope":            schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}, Description: "agent | layer | orchestration | workspace"},
			"workspace_id":     schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"orchestration_id": schema.StringAttribute{Optional: true, Computed: true, Default: stringdefault.StaticString(""), PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"agent_id":         schema.StringAttribute{Optional: true, Computed: true, Default: stringdefault.StaticString(""), PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"layer_id":         schema.StringAttribute{Optional: true, Computed: true, Default: stringdefault.StaticString(""), PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"path":             schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"content":          schema.StringAttribute{Optional: true, Description: "Inline text content. Mutually exclusive with source_path."},
			"source_path":      schema.StringAttribute{Optional: true, Description: "Path to a local file to upload. Supports binary files (e.g. .docx, .pdf). Mutually exclusive with content."},
			"source_hash":      schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}, Description: "SHA-256 hash of the uploaded file. Changes trigger re-upload."},
		},
	}
}

func (r *StorageFileResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.client = req.ProviderData.(*client.Client)
	}
}

// signedUploadPath returns the OAI API path for requesting a signed upload URL.
func (r *StorageFileResource) signedUploadPath(m storageFileModel) (string, error) {
	wid := m.WorkspaceID.ValueString()
	oid := m.OrchestrationID.ValueString()
	aid := m.AgentID.ValueString()
	lid := m.LayerID.ValueString()
	switch m.Scope.ValueString() {
	case "workspace":
		return fmt.Sprintf("/workspaces/%s/storage/files", wid), nil
	case "orchestration":
		return fmt.Sprintf("/workspaces/%s/orchestrations/%s/storage/files", wid, oid), nil
	case "agent":
		return fmt.Sprintf("/workspaces/%s/orchestrations/%s/agents/%s/storage/files", wid, oid, aid), nil
	case "layer":
		return fmt.Sprintf("/workspaces/%s/orchestrations/%s/agents/%s/layers/%s/storage/files", wid, oid, aid, lid), nil
	}
	return "", fmt.Errorf("invalid scope %q: must be workspace, orchestration, agent, or layer", m.Scope.ValueString())
}

// downloadPath returns the OAI API path for downloading/deleting a file (path as query param).
func (r *StorageFileResource) downloadPath(m storageFileModel) (string, error) {
	filePath := strings.TrimPrefix(m.Path.ValueString(), "/")
	wid := m.WorkspaceID.ValueString()
	oid := m.OrchestrationID.ValueString()
	aid := m.AgentID.ValueString()
	lid := m.LayerID.ValueString()
	switch m.Scope.ValueString() {
	case "workspace":
		return fmt.Sprintf("/workspaces/%s/storage/files?path=%s", wid, filePath), nil
	case "orchestration":
		return fmt.Sprintf("/workspaces/%s/orchestrations/%s/storage/files?path=%s", wid, oid, filePath), nil
	case "agent":
		return fmt.Sprintf("/workspaces/%s/orchestrations/%s/agents/%s/storage/files?path=%s", wid, oid, aid, filePath), nil
	case "layer":
		return fmt.Sprintf("/workspaces/%s/orchestrations/%s/agents/%s/layers/%s/storage/files?path=%s", wid, oid, aid, lid, filePath), nil
	}
	return "", fmt.Errorf("invalid scope %q", m.Scope.ValueString())
}

func (r *StorageFileResource) validate(plan storageFileModel) error {
	hasContent := !plan.Content.IsNull() && !plan.Content.IsUnknown()
	hasSource := !plan.SourcePath.IsNull() && !plan.SourcePath.IsUnknown()
	if hasContent == hasSource {
		return fmt.Errorf("exactly one of content or source_path must be set")
	}
	return nil
}

func (r *StorageFileResource) upload(plan storageFileModel) (hash string, err error) {
	var data []byte
	var contentType string

	if !plan.SourcePath.IsNull() && !plan.SourcePath.IsUnknown() {
		data, err = os.ReadFile(plan.SourcePath.ValueString())
		if err != nil {
			return "", fmt.Errorf("failed to read source_path: %w", err)
		}
		contentType = mime.TypeByExtension(filepath.Ext(plan.SourcePath.ValueString()))
		if contentType == "" {
			contentType = "application/octet-stream"
		}
	} else {
		data = []byte(plan.Content.ValueString())
		contentType = "text/plain"
	}

	// Step 1: request signed upload URL from OAI API
	apiPath, err := r.signedUploadPath(plan)
	if err != nil {
		return "", err
	}
	httpResp, err := r.client.Do(http.MethodPost, apiPath, map[string]any{
		"path":         plan.Path.ValueString(),
		"content_type": contentType,
	})
	if err != nil {
		return "", fmt.Errorf("failed to get signed upload URL: %w", err)
	}
	var signedResp struct {
		UploadURL    string `json:"upload_url"`
		MaxSizeBytes int64  `json:"max_size_bytes"`
	}
	if err := client.DecodeResponse(httpResp, &signedResp); err != nil {
		return "", fmt.Errorf("failed to decode signed URL response: %w", err)
	}
	if signedResp.MaxSizeBytes == 0 {
		signedResp.MaxSizeBytes = 104857600 // 100MB default
	}

	// Step 2: PUT directly to GCS signed URL with required headers
	gcsResp, err := r.client.DoSignedUpload(signedResp.UploadURL, bytes.NewReader(data), contentType, signedResp.MaxSizeBytes)
	if err != nil {
		return "", fmt.Errorf("GCS upload failed: %w", err)
	}
	if err := client.DecodeResponse(gcsResp, nil); err != nil {
		return "", fmt.Errorf("GCS upload failed: %w", err)
	}

	return fmt.Sprintf("%x", sha256.Sum256(data)), nil
}

func (r *StorageFileResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan storageFileModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	if err := r.validate(plan); err != nil {
		resp.Diagnostics.AddError("Invalid configuration", err.Error())
		return
	}
	hash, err := r.upload(plan)
	if err != nil {
		resp.Diagnostics.AddError("Upload file failed", err.Error())
		return
	}
	plan.ID = types.StringValue(plan.Scope.ValueString() + ":" + plan.Path.ValueString())
	plan.SourceHash = types.StringValue(hash)
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *StorageFileResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state storageFileModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	// Binary files can't round-trip through string state — drift detected via source_hash.
	if !state.SourcePath.IsNull() && !state.SourcePath.IsUnknown() {
		resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
		return
	}
	apiPath, err := r.downloadPath(state)
	if err != nil {
		resp.Diagnostics.AddError("Invalid storage scope", err.Error())
		return
	}
	httpResp, err := r.client.Do(http.MethodGet, apiPath, nil)
	if err != nil {
		resp.Diagnostics.AddError("Download file failed", err.Error())
		return
	}
	defer httpResp.Body.Close()
	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		body, _ := io.ReadAll(httpResp.Body)
		resp.Diagnostics.AddError("Download file failed", fmt.Sprintf("API error %d: %s", httpResp.StatusCode, string(body)))
		return
	}
	var buf bytes.Buffer
	if _, err := io.Copy(&buf, httpResp.Body); err != nil {
		resp.Diagnostics.AddError("Read file content failed", err.Error())
		return
	}
	state.Content = types.StringValue(buf.String())
	state.SourceHash = types.StringValue(fmt.Sprintf("%x", sha256.Sum256(buf.Bytes())))
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *StorageFileResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan storageFileModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	if err := r.validate(plan); err != nil {
		resp.Diagnostics.AddError("Invalid configuration", err.Error())
		return
	}
	hash, err := r.upload(plan)
	if err != nil {
		resp.Diagnostics.AddError("Update file failed", err.Error())
		return
	}
	plan.SourceHash = types.StringValue(hash)
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *StorageFileResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state storageFileModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	apiPath, err := r.downloadPath(state)
	if err != nil {
		resp.Diagnostics.AddError("Invalid storage scope", err.Error())
		return
	}
	httpResp, err := r.client.Do(http.MethodDelete, apiPath, nil)
	if err != nil {
		resp.Diagnostics.AddError("Delete file failed", err.Error())
		return
	}
	client.DecodeResponse(httpResp, nil)
}
