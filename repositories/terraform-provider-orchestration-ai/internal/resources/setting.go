package resources

import (
	"context"
	"fmt"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/booldefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/make-orchestration-ai/terraform-provider-orchestration-ai/internal/client"
)

type SettingResource struct{ client *client.Client }

type settingModel struct {
	ID                 types.String `tfsdk:"id"`
	WorkspaceID        types.String `tfsdk:"workspace_id"`
	OrchestrationID    types.String `tfsdk:"orchestration_id"`
	AgentID            types.String `tfsdk:"agent_id"`
	SettingName        types.String `tfsdk:"setting_name"`
	SettingDescription types.String `tfsdk:"setting_description"`
	SettingType        types.String `tfsdk:"setting_type"`
	TextValue          types.String `tfsdk:"text_value"`
	BooleanValue       types.Bool   `tfsdk:"boolean_value"`
}

func NewSettingResource() resource.Resource { return &SettingResource{} }

func (r *SettingResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_setting"
}

func (r *SettingResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":                  schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"workspace_id":        schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"orchestration_id":    schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"agent_id":            schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"setting_name":        schema.StringAttribute{Required: true},
			"setting_description": schema.StringAttribute{Required: true},
			"setting_type":        schema.StringAttribute{Required: true},
			"text_value":          schema.StringAttribute{Optional: true, Computed: true, Default: stringdefault.StaticString("")},
			"boolean_value":       schema.BoolAttribute{Optional: true, Computed: true, Default: booldefault.StaticBool(false)},
		},
	}
}

func (r *SettingResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.client = req.ProviderData.(*client.Client)
	}
}

func (r *SettingResource) basePath(m settingModel) string {
	return fmt.Sprintf("/workspaces/%s/orchestrations/%s/agents/%s/settings",
		m.WorkspaceID.ValueString(), m.OrchestrationID.ValueString(), m.AgentID.ValueString())
}

func (r *SettingResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan settingModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{
		"setting_name":        plan.SettingName.ValueString(),
		"setting_description": plan.SettingDescription.ValueString(),
		"setting_type":        plan.SettingType.ValueString(),
		"text_value":          plan.TextValue.ValueString(),
		"boolean_value":       plan.BooleanValue.ValueBool(),
	}
	httpResp, err := r.client.Do(http.MethodPost, r.basePath(plan), body)
	if err != nil {
		resp.Diagnostics.AddError("Create setting failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Create setting failed", err.Error())
		return
	}
	plan.ID = types.StringValue(fmt.Sprintf("%v", result["id"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *SettingResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state settingModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodGet, r.basePath(state)+"/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Read setting failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Read setting failed", err.Error())
		return
	}
	state.SettingName = types.StringValue(fmt.Sprintf("%v", result["setting_name"]))
	state.SettingDescription = types.StringValue(fmt.Sprintf("%v", result["setting_description"]))
	state.SettingType = types.StringValue(fmt.Sprintf("%v", result["setting_type"]))
	state.TextValue = types.StringValue(fmt.Sprintf("%v", result["text_value"]))
	if v, ok := result["boolean_value"].(bool); ok {
		state.BooleanValue = types.BoolValue(v)
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *SettingResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan settingModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{
		"setting_name":        plan.SettingName.ValueString(),
		"setting_description": plan.SettingDescription.ValueString(),
		"setting_type":        plan.SettingType.ValueString(),
		"text_value":          plan.TextValue.ValueString(),
		"boolean_value":       plan.BooleanValue.ValueBool(),
	}
	httpResp, err := r.client.Do(http.MethodPatch, r.basePath(plan)+"/"+plan.ID.ValueString(), body)
	if err != nil {
		resp.Diagnostics.AddError("Update setting failed", err.Error())
		return
	}
	if err := client.DecodeResponse(httpResp, nil); err != nil {
		resp.Diagnostics.AddError("Update setting failed", err.Error())
		return
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *SettingResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state settingModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodDelete, r.basePath(state)+"/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Delete setting failed", err.Error())
		return
	}
	client.DecodeResponse(httpResp, nil)
}
