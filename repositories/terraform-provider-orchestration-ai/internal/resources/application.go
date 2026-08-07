package resources

import (
	"context"
	"fmt"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/booldefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/make-orchestration-ai/terraform-provider-orchestration-ai/internal/client"
)

type ApplicationResource struct{ client *client.Client }

type applicationModel struct {
	ID                     types.String `tfsdk:"id"`
	ApplicationName        types.String `tfsdk:"application_name"`
	ApplicationDescription types.String `tfsdk:"application_description_md"`
	ApplicationURL         types.String `tfsdk:"application_url"`
	AccessKey              types.String `tfsdk:"access_key"`
	Private                types.Bool   `tfsdk:"private"`
	Visible                types.Bool   `tfsdk:"visible"`
}

func NewApplicationResource() resource.Resource { return &ApplicationResource{} }

func (r *ApplicationResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_application"
}

func (r *ApplicationResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":                        schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"application_name":          schema.StringAttribute{Required: true},
			"application_description_md": schema.StringAttribute{Required: true},
			"application_url":           schema.StringAttribute{Required: true},
			"access_key":                schema.StringAttribute{Required: true},
			"private":                   schema.BoolAttribute{Optional: true, Computed: true, Default: booldefault.StaticBool(false)},
			"visible":                   schema.BoolAttribute{Optional: true, Computed: true, Default: booldefault.StaticBool(true)},
		},
	}
}

func (r *ApplicationResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.client = req.ProviderData.(*client.Client)
	}
}

func (r *ApplicationResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan applicationModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{
		"application_name":           plan.ApplicationName.ValueString(),
		"application_description_md": plan.ApplicationDescription.ValueString(),
		"application_url":            plan.ApplicationURL.ValueString(),
		"access_key":                 plan.AccessKey.ValueString(),
		"private":                    plan.Private.ValueBool(),
		"visible":                    plan.Visible.ValueBool(),
	}
	httpResp, err := r.client.Do(http.MethodPost, "/applications", body)
	if err != nil {
		resp.Diagnostics.AddError("Create application failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Create application failed", err.Error())
		return
	}
	plan.ID = types.StringValue(fmt.Sprintf("%v", result["id"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *ApplicationResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state applicationModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodGet, "/applications/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Read application failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Read application failed", err.Error())
		return
	}
	state.ApplicationName = types.StringValue(fmt.Sprintf("%v", result["application_name"]))
	state.ApplicationDescription = types.StringValue(fmt.Sprintf("%v", result["application_description_md"]))
	state.ApplicationURL = types.StringValue(fmt.Sprintf("%v", result["application_url"]))
	state.AccessKey = types.StringValue(fmt.Sprintf("%v", result["access_key"]))
	if v, ok := result["private"].(bool); ok {
		state.Private = types.BoolValue(v)
	}
	if v, ok := result["visible"].(bool); ok {
		state.Visible = types.BoolValue(v)
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *ApplicationResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan applicationModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{
		"application_name":           plan.ApplicationName.ValueString(),
		"application_description_md": plan.ApplicationDescription.ValueString(),
		"application_url":            plan.ApplicationURL.ValueString(),
		"access_key":                 plan.AccessKey.ValueString(),
		"private":                    plan.Private.ValueBool(),
		"visible":                    plan.Visible.ValueBool(),
	}
	httpResp, err := r.client.Do(http.MethodPatch, "/applications/"+plan.ID.ValueString(), body)
	if err != nil {
		resp.Diagnostics.AddError("Update application failed", err.Error())
		return
	}
	if err := client.DecodeResponse(httpResp, nil); err != nil {
		resp.Diagnostics.AddError("Update application failed", err.Error())
		return
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *ApplicationResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state applicationModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodDelete, "/applications/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Delete application failed", err.Error())
		return
	}
	client.DecodeResponse(httpResp, nil)
}
