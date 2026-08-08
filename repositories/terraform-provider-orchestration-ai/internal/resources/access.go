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

type AccessResource struct{ client *client.Client }

type accessModel struct {
	ID             types.String `tfsdk:"id"`
	PrincipalID    types.String `tfsdk:"principal_id"`
	PrincipalName  types.String `tfsdk:"principal_name"`
	PrincipalEmail types.String `tfsdk:"principal_email"`
	ResourceID     types.String `tfsdk:"resource_id"`
	Role           types.String `tfsdk:"role"`
}

func NewAccessResource() resource.Resource { return &AccessResource{} }

func (r *AccessResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_access"
}

func (r *AccessResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":               schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"principal_id":     schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"principal_name":   schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"principal_email":  schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"resource_id":      schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"role":             schema.StringAttribute{Required: true},
		},
	}
}

func (r *AccessResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.client = req.ProviderData.(*client.Client)
	}
}

func (r *AccessResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan accessModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{
		"principal_id":    plan.PrincipalID.ValueString(),
		"principal_name":  plan.PrincipalName.ValueString(),
		"principal_email": plan.PrincipalEmail.ValueString(),
		"resource_id":     plan.ResourceID.ValueString(),
		"role":            plan.Role.ValueString(),
	}
	httpResp, err := r.client.Do(http.MethodPost, "/access", body)
	if err != nil {
		resp.Diagnostics.AddError("Create access failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Create access failed", err.Error())
		return
	}
	plan.ID = types.StringValue(fmt.Sprintf("%v", result["id"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *AccessResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state accessModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodGet, "/access/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Read access failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Read access failed", err.Error())
		return
	}
	state.PrincipalID = types.StringValue(fmt.Sprintf("%v", result["principal_id"]))
	state.PrincipalName = types.StringValue(fmt.Sprintf("%v", result["principal_name"]))
	state.PrincipalEmail = types.StringValue(fmt.Sprintf("%v", result["principal_email"]))
	state.ResourceID = types.StringValue(fmt.Sprintf("%v", result["resource_id"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

// Access grants are immutable — role changes require destroy+create.
func (r *AccessResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan accessModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *AccessResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state accessModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodDelete, "/access/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Delete access failed", err.Error())
		return
	}
	client.DecodeResponse(httpResp, nil)
}
