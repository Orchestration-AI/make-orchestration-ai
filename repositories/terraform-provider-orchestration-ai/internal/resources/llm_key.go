package resources

import (
	"context"
	"fmt"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/make-orchestration-ai/terraform-provider-orchestration-ai/internal/client"
)

// LlmKeyResource manages OAuth credentials for an LLM provider.
// After creation, the API asynchronously discovers available LLMs (up to ~1 minute).
type LlmKeyResource struct{ client *client.Client }

type llmKeyModel struct {
	ID           types.String `tfsdk:"id"`
	ClientID     types.String `tfsdk:"client_id"`
	ClientSecret types.String `tfsdk:"client_secret"`
	Provider     types.String `tfsdk:"llm_provider"`
}

func NewLlmKeyResource() resource.Resource { return &LlmKeyResource{} }

func (r *LlmKeyResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_llm_key"
}

func (r *LlmKeyResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":            schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"client_id":     schema.StringAttribute{Required: true},
			"client_secret": schema.StringAttribute{Required: true, Sensitive: true},
			"llm_provider":  schema.StringAttribute{Required: true, Description: "Google | GoogleOAI | OpenAI | Anthropic"},
		},
	}
}

func (r *LlmKeyResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.client = req.ProviderData.(*client.Client)
	}
}

func (r *LlmKeyResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan llmKeyModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{
		"client_id":     plan.ClientID.ValueString(),
		"client_secret": plan.ClientSecret.ValueString(),
		"provider":      plan.Provider.ValueString(),
	}
	httpResp, err := r.client.Do(http.MethodPost, "/llm-keys", body)
	if err != nil {
		resp.Diagnostics.AddError("Create llm_key failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Create llm_key failed", err.Error())
		return
	}
	plan.ID = types.StringValue(fmt.Sprintf("%v", result["id"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *LlmKeyResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state llmKeyModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodGet, "/llm-keys/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Read llm_key failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Read llm_key failed", err.Error())
		return
	}
	state.ClientID = types.StringValue(fmt.Sprintf("%v", result["client_id"]))
	state.Provider = types.StringValue(fmt.Sprintf("%v", result["provider"]))

	// client_secret is not returned by the API — preserve existing state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *LlmKeyResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan llmKeyModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{
		"client_id":     plan.ClientID.ValueString(),
		"client_secret": plan.ClientSecret.ValueString(),
		"provider":      plan.Provider.ValueString(),
	}
	httpResp, err := r.client.Do(http.MethodPatch, "/llm-keys/"+plan.ID.ValueString(), body)
	if err != nil {
		resp.Diagnostics.AddError("Update llm_key failed", err.Error())
		return
	}
	if err := client.DecodeResponse(httpResp, nil); err != nil {
		resp.Diagnostics.AddError("Update llm_key failed", err.Error())
		return
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

// Delete is a no-op — the SDK has no delete endpoint for llm-keys.
func (r *LlmKeyResource) Delete(_ context.Context, _ resource.DeleteRequest, _ *resource.DeleteResponse) {}
