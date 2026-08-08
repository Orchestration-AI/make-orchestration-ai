package resources

import (
	"context"
	"fmt"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/make-orchestration-ai/terraform-provider-orchestration-ai/internal/client"
)

type TaskResource struct{ client *client.Client }

type taskModel struct {
	ID              types.String `tfsdk:"id"`
	WorkspaceID     types.String `tfsdk:"workspace_id"`
	OrchestrationID types.String `tfsdk:"orchestration_id"`
	AgentID         types.String `tfsdk:"agent_id"`
	Message         types.String `tfsdk:"message"`
	CronExpression  types.String `tfsdk:"cron_expression"`
}

func NewTaskResource() resource.Resource { return &TaskResource{} }

func (r *TaskResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_task"
}

func (r *TaskResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":               schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"workspace_id":     schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"orchestration_id": schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"agent_id":         schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"message":          schema.StringAttribute{Required: true},
			"cron_expression":  schema.StringAttribute{Optional: true, Computed: true, Default: stringdefault.StaticString("")},
		},
	}
}

func (r *TaskResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.client = req.ProviderData.(*client.Client)
	}
}

func (r *TaskResource) basePath(m taskModel) string {
	return fmt.Sprintf("/workspaces/%s/orchestrations/%s/agents/%s/tasks",
		m.WorkspaceID.ValueString(), m.OrchestrationID.ValueString(), m.AgentID.ValueString())
}

func (r *TaskResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan taskModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{
		"message": plan.Message.ValueString(),
	}
	if v := plan.CronExpression.ValueString(); v != "" {
		body["cron_expression"] = v
	}
	httpResp, err := r.client.Do(http.MethodPost, r.basePath(plan), body)
	if err != nil {
		resp.Diagnostics.AddError("Create task failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Create task failed", err.Error())
		return
	}
	plan.ID = types.StringValue(fmt.Sprintf("%v", result["id"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *TaskResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state taskModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodGet, r.basePath(state)+"/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Read task failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Read task failed", err.Error())
		return
	}
	state.Message = types.StringValue(fmt.Sprintf("%v", result["message"]))
	if v, ok := result["cron_expression"].(string); ok {
		state.CronExpression = types.StringValue(v)
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

// Tasks are immutable after creation — update forces replacement via RequiresReplace on parent IDs.
// A message/cron change requires destroy+create.
func (r *TaskResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan taskModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *TaskResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state taskModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodDelete, r.basePath(state)+"/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Delete task failed", err.Error())
		return
	}
	client.DecodeResponse(httpResp, nil)
}
