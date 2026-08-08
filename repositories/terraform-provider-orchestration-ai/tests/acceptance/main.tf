terraform {
  required_providers {
    oai = {
      source = "orchestration-ai/orchestration-ai"
    }
  }
}

provider "oai" {
  client_id     = var.oai_client_id
  client_secret = var.oai_client_secret
  base_url      = var.oai_base_url
}

variable "oai_client_id"     { }
variable "oai_client_secret" { sensitive = true }
variable "oai_base_url"      { default = "" }

# ── Application ──────────────────────────────────────────────────────────────

resource "oai_application" "test" {
  application_name           = "tf-acceptance-application"
  application_description_md = "Acceptance test application"
  application_url            = "https://example.com"
  access_key                 = "tf-acceptance-key"
}

# ── Workspace ─────────────────────────────────────────────────────────────────

resource "oai_workspace" "test" {
  workspace_name = "tf-acceptance-workspace"
  applications   = [oai_application.test.id]
}

# ── Orchestration ─────────────────────────────────────────────────────────────

resource "oai_orchestration" "test" {
  workspace_id              = oai_workspace.test.id
  orchestration_name        = "tf-acceptance-orchestration"
  orchestration_description = "Acceptance test orchestration"
}

# ── Agent ─────────────────────────────────────────────────────────────────────

resource "oai_agent" "test" {
  workspace_id      = oai_workspace.test.id
  orchestration_id  = oai_orchestration.test.id
  agent_name        = "tf-acceptance-agent"
  agent_description = "Acceptance test agent"
  vm_enabled        = true
}

# ── Endpoint ──────────────────────────────────────────────────────────────────

resource "oai_endpoint" "test" {
  workspace_id     = oai_workspace.test.id
  orchestration_id = oai_orchestration.test.id
  agent_id         = oai_agent.test.id
  description      = "tf-acceptance-endpoint"
  endpoint         = "/test"
}

# ── Layer ─────────────────────────────────────────────────────────────────────
# llm_id is intentionally omitted — LLMs are discovered async after llm_key
# creation. Set llm_id in a follow-up apply once discovery completes.

resource "oai_layer" "test" {
  workspace_id     = oai_workspace.test.id
  orchestration_id = oai_orchestration.test.id
  agent_id         = oai_agent.test.id
  layer_name       = "tf-acceptance-layer"
  context_md       = "You are a helpful assistant."
  temperature      = 0.7
}

# ── Link ──────────────────────────────────────────────────────────────────────

resource "oai_link" "test" {
  workspace_id     = oai_workspace.test.id
  orchestration_id = oai_orchestration.test.id
  agent_id         = oai_agent.test.id
  link_name        = "tf-acceptance-link"
  link_description = "Acceptance test link"
  link_url         = "https://example.com/link"
}

# ── Setting ───────────────────────────────────────────────────────────────────

resource "oai_setting" "test" {
  workspace_id        = oai_workspace.test.id
  orchestration_id    = oai_orchestration.test.id
  agent_id            = oai_agent.test.id
  setting_name        = "tf-acceptance-setting"
  setting_description = "Acceptance test setting"
  setting_type        = "Text"
  text_value          = "hello"
  boolean_value       = false
}

# ── Task ──────────────────────────────────────────────────────────────────────

resource "oai_task" "test" {
  workspace_id     = oai_workspace.test.id
  orchestration_id = oai_orchestration.test.id
  agent_id         = oai_agent.test.id
  message          = "acceptance test task"
  cron_expression  = "0 9 * * 1-5"
}

variable "oai_test_llm_client_id"     {}
variable "oai_test_llm_client_secret" { sensitive = true }

# ── Access ────────────────────────────────────────────────────────────────────

resource "oai_access" "test" {
  principal_id    = var.oai_test_principal_id
  principal_name  = var.oai_test_principal_name
  principal_email = var.oai_test_principal_email
  resource_id     = oai_workspace.test.id
  role            = "viewer"
}

variable "oai_test_principal_id"    { default = "" }
variable "oai_test_principal_name"  { default = "" }
variable "oai_test_principal_email" { default = "" }

# ── Ticker config — workspace scope ───────────────────────────────────────────

resource "oai_ticker_config" "workspace" {
  scope           = "workspace"
  workspace_id    = oai_workspace.test.id
  enabled         = true
  cadence_minutes = 60
  inherit         = false

  work_hours = {
    monday    = { start = 9, end = 17 }
    tuesday   = { start = 9, end = 17 }
    wednesday = { start = 9, end = 17 }
    thursday  = { start = 9, end = 17 }
    friday    = { start = 9, end = 17 }
  }
}

# ── Ticker config — agent scope ───────────────────────────────────────────────

resource "oai_ticker_config" "agent" {
  scope            = "agent"
  workspace_id     = oai_workspace.test.id
  orchestration_id = oai_orchestration.test.id
  agent_id         = oai_agent.test.id
  enabled          = true
  cadence_minutes  = 30
  inherit          = true
}

# ── Storage dir ───────────────────────────────────────────────────────────────

resource "oai_storage_dir" "test" {
  scope            = "agent"
  workspace_id     = oai_workspace.test.id
  orchestration_id = oai_orchestration.test.id
  agent_id         = oai_agent.test.id
  path             = "config"
}

# ── Storage file ──────────────────────────────────────────────────────────────

resource "oai_storage_file" "test" {
  scope            = "agent"
  workspace_id     = oai_workspace.test.id
  orchestration_id = oai_orchestration.test.id
  agent_id         = oai_agent.test.id
  path             = "config/settings.json"
  content          = jsonencode({ environment = "acceptance-test" })

  depends_on = [oai_storage_dir.test]
}
