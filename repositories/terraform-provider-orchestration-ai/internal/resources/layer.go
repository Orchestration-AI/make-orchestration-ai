package resources

import (
	"context"
	"fmt"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/float64default"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/make-orchestration-ai/terraform-provider-orchestration-ai/internal/client"
)

type LayerResource struct{ client *client.Client }

type layerModel struct {
	ID              types.String  `tfsdk:"id"`
	WorkspaceID     types.String  `tfsdk:"workspace_id"`
	OrchestrationID types.String  `tfsdk:"orchestration_id"`
	AgentID         types.String  `tfsdk:"agent_id"`
	LayerName       types.String  `tfsdk:"layer_name"`
	ContextMD       types.String  `tfsdk:"context_md"`
	Temperature     types.Float64 `tfsdk:"temperature"`
	LlmID           types.String  `tfsdk:"llm_id"`
	ServiceIDs      types.Set     `tfsdk:"service_ids"`
}

func NewLayerResource() resource.Resource { return &LayerResource{} }

func (r *LayerResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_layer"
}

func (r *LayerResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":               schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"workspace_id":     schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"orchestration_id": schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"agent_id":         schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"layer_name":       schema.StringAttribute{Required: true},
			"context_md":       schema.StringAttribute{Optional: true, Computed: true, Default: stringdefault.StaticString("")},
			"temperature":      schema.Float64Attribute{Optional: true, Computed: true, Default: float64default.StaticFloat64(0.7)},
			"llm_id":      schema.StringAttribute{Optional: true, Computed: true, Default: stringdefault.StaticString(""), Description: "ID of the LLM to assign to this layer. LLMs become available after an llm_key is created (allow up to 1 minute for discovery)."},
			"service_ids": schema.SetAttribute{Optional: true, ElementType: types.StringType, Description: "IDs of services to attach to this layer."},
		},
	}
}

func (r *LayerResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.client = req.ProviderData.(*client.Client)
	}
}

func (r *LayerResource) basePath(m layerModel) string {
	return fmt.Sprintf("/workspaces/%s/orchestrations/%s/agents/%s/layers",
		m.WorkspaceID.ValueString(), m.OrchestrationID.ValueString(), m.AgentID.ValueString())
}

func (r *LayerResource) buildBody(ctx context.Context, plan layerModel) map[string]any {
	body := map[string]any{
		"layer_name":  plan.LayerName.ValueString(),
		"temperature": plan.Temperature.ValueFloat64(),
	}
	if !plan.ContextMD.IsNull() && !plan.ContextMD.IsUnknown() {
		body["context_md"] = plan.ContextMD.ValueString()
	}
	if !plan.LlmID.IsNull() && !plan.LlmID.IsUnknown() && plan.LlmID.ValueString() != "" {
		body["llm"] = map[string]any{"id": plan.LlmID.ValueString()}
	}
	if !plan.ServiceIDs.IsNull() && !plan.ServiceIDs.IsUnknown() {
		ids := toStringSlice(ctx, plan.ServiceIDs)
		svcs := make([]map[string]any, len(ids))
		for i, id := range ids {
			svcs[i] = map[string]any{"id": id}
		}
		body["services"] = svcs
	}
	return body
}

func (r *LayerResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan layerModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodPost, r.basePath(plan), r.buildBody(ctx, plan))
	if err != nil {
		resp.Diagnostics.AddError("Create layer failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Create layer failed", err.Error())
		return
	}
	plan.ID = types.StringValue(fmt.Sprintf("%v", result["id"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *LayerResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state layerModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodGet, r.basePath(state)+"/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Read layer failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Read layer failed", err.Error())
		return
	}
	state.LayerName = types.StringValue(fmt.Sprintf("%v", result["layer_name"]))
	if v, ok := result["context_md"].(string); ok {
		state.ContextMD = types.StringValue(v)
	}
	if v, ok := result["temperature"].(float64); ok {
		state.Temperature = types.Float64Value(v)
	}
	if llm, ok := result["llm"].(map[string]any); ok {
		state.LlmID = types.StringValue(fmt.Sprintf("%v", llm["id"]))
	}
	if svcs, ok := result["services"].([]any); ok {
		ids := make([]string, 0, len(svcs))
		for _, s := range svcs {
			if m, ok := s.(map[string]any); ok {
				if id, ok := m["id"].(string); ok {
					ids = append(ids, id)
				}
			}
		}
		set, diags := types.SetValueFrom(ctx, types.StringType, ids)
		resp.Diagnostics.Append(diags...)
		state.ServiceIDs = set
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *LayerResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan layerModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodPatch, r.basePath(plan)+"/"+plan.ID.ValueString(), r.buildBody(ctx, plan))
	if err != nil {
		resp.Diagnostics.AddError("Update layer failed", err.Error())
		return
	}
	if err := client.DecodeResponse(httpResp, nil); err != nil {
		resp.Diagnostics.AddError("Update layer failed", err.Error())
		return
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *LayerResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state layerModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodDelete, r.basePath(state)+"/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Delete layer failed", err.Error())
		return
	}
	client.DecodeResponse(httpResp, nil)
}
