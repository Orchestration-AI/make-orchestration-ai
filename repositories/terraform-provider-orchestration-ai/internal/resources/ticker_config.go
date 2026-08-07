package resources

import (
	"context"
	"fmt"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/booldefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-framework/types/basetypes"
	"github.com/make-orchestration-ai/terraform-provider-orchestration-ai/internal/client"
)

// TickerConfigResource manages ticker configs at workspace, orchestration, or agent scope.
// The API is upsert-based (PUT), so create and update both call the same endpoint.
// Delete is a no-op — there is no delete endpoint for ticker configs.
type TickerConfigResource struct{ client *client.Client }

// workDayModel represents a single day's working hours window.
type workDayModel struct {
	Start types.Int64 `tfsdk:"start"`
	End   types.Int64 `tfsdk:"end"`
}

var workDayAttrTypes = map[string]attr.Type{
	"start": types.Int64Type,
	"end":   types.Int64Type,
}

// workHoursModel holds an optional window per day of the week.
type workHoursModel struct {
	Sunday    types.Object `tfsdk:"sunday"`
	Monday    types.Object `tfsdk:"monday"`
	Tuesday   types.Object `tfsdk:"tuesday"`
	Wednesday types.Object `tfsdk:"wednesday"`
	Thursday  types.Object `tfsdk:"thursday"`
	Friday    types.Object `tfsdk:"friday"`
	Saturday  types.Object `tfsdk:"saturday"`
}

var workHoursAttrTypes = map[string]attr.Type{
	"sunday":    types.ObjectType{AttrTypes: workDayAttrTypes},
	"monday":    types.ObjectType{AttrTypes: workDayAttrTypes},
	"tuesday":   types.ObjectType{AttrTypes: workDayAttrTypes},
	"wednesday": types.ObjectType{AttrTypes: workDayAttrTypes},
	"thursday":  types.ObjectType{AttrTypes: workDayAttrTypes},
	"friday":    types.ObjectType{AttrTypes: workDayAttrTypes},
	"saturday":  types.ObjectType{AttrTypes: workDayAttrTypes},
}

type tickerConfigModel struct {
	ID              types.String `tfsdk:"id"`
	Scope           types.String `tfsdk:"scope"`
	WorkspaceID     types.String `tfsdk:"workspace_id"`
	OrchestrationID types.String `tfsdk:"orchestration_id"`
	AgentID         types.String `tfsdk:"agent_id"`
	Enabled         types.Bool   `tfsdk:"enabled"`
	CadenceMinutes  types.Int64  `tfsdk:"cadence_minutes"`
	Inherit         types.Bool   `tfsdk:"inherit"`
	WorkHours       types.Object `tfsdk:"work_hours"` // null = no schedule restriction
}

func NewTickerConfigResource() resource.Resource { return &TickerConfigResource{} }

func (r *TickerConfigResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_ticker_config"
}

func daySchema() schema.SingleNestedAttribute {
	return schema.SingleNestedAttribute{
		Optional: true,
		Attributes: map[string]schema.Attribute{
			"start": schema.Int64Attribute{Required: true, Description: "Start hour in UTC (0-23)."},
			"end":   schema.Int64Attribute{Required: true, Description: "End hour in UTC (0-23)."},
		},
	}
}

func (r *TickerConfigResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":               schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"scope":            schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}, Description: "workspace | orchestration | agent"},
			"workspace_id":     schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"orchestration_id": schema.StringAttribute{Optional: true, Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}, Default: stringdefault.StaticString("")},
			"agent_id":         schema.StringAttribute{Optional: true, Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}, Default: stringdefault.StaticString("")},
			"enabled":          schema.BoolAttribute{Optional: true, Computed: true, Default: booldefault.StaticBool(true)},
			"cadence_minutes":  schema.Int64Attribute{Required: true},
			"inherit":          schema.BoolAttribute{Optional: true, Computed: true, Default: booldefault.StaticBool(false), Description: "Inherit ticker config from parent scope."},
			"work_hours": schema.SingleNestedAttribute{
				Optional:    true,
				Description: "Working hours per day of the week (UTC). Omit a day to disable the ticker on that day.",
				Attributes: map[string]schema.Attribute{
					"sunday":    daySchema(),
					"monday":    daySchema(),
					"tuesday":   daySchema(),
					"wednesday": daySchema(),
					"thursday":  daySchema(),
					"friday":    daySchema(),
					"saturday":  daySchema(),
				},
			},
		},
	}
}

func (r *TickerConfigResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.client = req.ProviderData.(*client.Client)
	}
}

func (r *TickerConfigResource) upsertPath(m tickerConfigModel) (string, error) {
	switch m.Scope.ValueString() {
	case "workspace":
		return fmt.Sprintf("/workspaces/%s/ticker", m.WorkspaceID.ValueString()), nil
	case "orchestration":
		return fmt.Sprintf("/workspaces/%s/orchestrations/%s/ticker",
			m.WorkspaceID.ValueString(), m.OrchestrationID.ValueString()), nil
	case "agent":
		return fmt.Sprintf("/workspaces/%s/orchestrations/%s/agents/%s/ticker",
			m.WorkspaceID.ValueString(), m.OrchestrationID.ValueString(), m.AgentID.ValueString()), nil
	}
	return "", fmt.Errorf("invalid scope %q: must be workspace, orchestration, or agent", m.Scope.ValueString())
}

// workHoursToAPI converts the Terraform object into the map[string]any the API expects.
func workHoursToAPI(ctx context.Context, obj types.Object) map[string]any {
	if obj.IsNull() || obj.IsUnknown() {
		return nil
	}
	var wh workHoursModel
	obj.As(ctx, &wh, basetypes.ObjectAsOptions{})

	days := map[string]types.Object{
		"sunday": wh.Sunday, "monday": wh.Monday, "tuesday": wh.Tuesday,
		"wednesday": wh.Wednesday, "thursday": wh.Thursday, "friday": wh.Friday,
		"saturday": wh.Saturday,
	}
	result := map[string]any{}
	for name, dayObj := range days {
		if dayObj.IsNull() || dayObj.IsUnknown() {
			continue
		}
		var d workDayModel
		dayObj.As(ctx, &d, basetypes.ObjectAsOptions{})
		result[name] = map[string]any{
			"start": d.Start.ValueInt64(),
			"end":   d.End.ValueInt64(),
		}
	}
	return result
}

// workHoursFromAPI converts the API response map back into a types.Object.
func workHoursFromAPI(ctx context.Context, raw map[string]any) types.Object {
	if raw == nil {
		return types.ObjectNull(workHoursAttrTypes)
	}

	dayObjs := map[string]attr.Value{}
	for _, name := range []string{"sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"} {
		v, ok := raw[name].(map[string]any)
		if !ok {
			dayObjs[name] = types.ObjectNull(workDayAttrTypes)
			continue
		}
		start, _ := v["start"].(float64)
		end, _ := v["end"].(float64)
		dayObj, _ := types.ObjectValue(workDayAttrTypes, map[string]attr.Value{
			"start": types.Int64Value(int64(start)),
			"end":   types.Int64Value(int64(end)),
		})
		dayObjs[name] = dayObj
	}

	obj, _ := types.ObjectValue(workHoursAttrTypes, dayObjs)
	return obj
}

func (r *TickerConfigResource) upsert(ctx context.Context, plan tickerConfigModel, diags interface {
	AddError(string, string)
}) *tickerConfigModel {
	path, err := r.upsertPath(plan)
	if err != nil {
		diags.AddError("Invalid ticker scope", err.Error())
		return nil
	}
	body := map[string]any{
		"enabled":         plan.Enabled.ValueBool(),
		"cadence_minutes": plan.CadenceMinutes.ValueInt64(),
		"inherit":         plan.Inherit.ValueBool(),
	}
	if wh := workHoursToAPI(ctx, plan.WorkHours); wh != nil {
		body["work_hours"] = wh
	}
	httpResp, err := r.client.Do(http.MethodPut, path, body)
	if err != nil {
		diags.AddError("Upsert ticker config failed", err.Error())
		return nil
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		diags.AddError("Upsert ticker config failed", err.Error())
		return nil
	}
	plan.ID = types.StringValue(fmt.Sprintf("%v", result["id"]))
	return &plan
}

func (r *TickerConfigResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan tickerConfigModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	result := r.upsert(ctx, plan, &resp.Diagnostics)
	if result != nil {
		resp.Diagnostics.Append(resp.State.Set(ctx, result)...)
	}
}

func (r *TickerConfigResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state tickerConfigModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	path, err := r.upsertPath(state)
	if err != nil {
		resp.Diagnostics.AddError("Invalid ticker scope", err.Error())
		return
	}
	httpResp, err := r.client.Do(http.MethodGet, path, nil)
	if err != nil {
		resp.Diagnostics.AddError("Read ticker config failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Read ticker config failed", err.Error())
		return
	}
	if v, ok := result["enabled"].(bool); ok {
		state.Enabled = types.BoolValue(v)
	}
	if v, ok := result["cadence_minutes"].(float64); ok {
		state.CadenceMinutes = types.Int64Value(int64(v))
	}
	if v, ok := result["inherit"].(bool); ok {
		state.Inherit = types.BoolValue(v)
	}
	if wh, ok := result["work_hours"].(map[string]any); ok {
		state.WorkHours = workHoursFromAPI(ctx, wh)
	} else {
		state.WorkHours = types.ObjectNull(workHoursAttrTypes)
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *TickerConfigResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan tickerConfigModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	result := r.upsert(ctx, plan, &resp.Diagnostics)
	if result != nil {
		resp.Diagnostics.Append(resp.State.Set(ctx, result)...)
	}
}

// Delete is a no-op — the API has no delete for ticker configs.
func (r *TickerConfigResource) Delete(_ context.Context, _ resource.DeleteRequest, _ *resource.DeleteResponse) {
}
