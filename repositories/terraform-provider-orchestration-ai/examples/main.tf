terraform {
  required_providers {
    oai = {
      source  = "orchestration-ai/orchestration-ai"
      version = "~> 0.1"
    }
  }
}

provider "oai" {
  # Can also be set via ORCHESTRATION_AI_CLIENT_ID / ORCHESTRATION_AI_CLIENT_SECRET
  client_id     = var.oai_client_id
  client_secret = var.oai_client_secret
}

variable "oai_client_id"     {}
variable "oai_client_secret" { sensitive = true }

# ── Application ───────────────────────────────────────────────────────────────

resource "oai_application" "main" {
  application_name           = "my-application"
  application_description_md = "My application"
  application_url            = "https://example.com"
  access_key                 = "my-access-key"
}

# ── Workspace ─────────────────────────────────────────────────────────────────

resource "oai_workspace" "main" {
  workspace_name = "my-workspace"
  applications   = [oai_application.main.id]
}

# ── Orchestration ─────────────────────────────────────────────────────────────

resource "oai_orchestration" "main" {
  workspace_id              = oai_workspace.main.id
  orchestration_name        = "my-orchestration"
  orchestration_description = "Does the thing"
}

# ── Agent ─────────────────────────────────────────────────────────────────────

resource "oai_agent" "main" {
  workspace_id      = oai_workspace.main.id
  orchestration_id  = oai_orchestration.main.id
  agent_name        = "my-agent"
  agent_description = "Handles the thing"
  vm_enabled        = true
}

# ── Layer ─────────────────────────────────────────────────────────────────────
# llm_id is optional — LLMs are discovered async after llm_key creation (~1 min)

resource "oai_layer" "main" {
  workspace_id     = oai_workspace.main.id
  orchestration_id = oai_orchestration.main.id
  agent_id         = oai_agent.main.id
  layer_name       = "my-layer"
  context_md       = "You are a helpful assistant."
  temperature      = 0.7
  # service_ids    = ["<service-id>"]
}

# ── Endpoint ──────────────────────────────────────────────────────────────────

resource "oai_endpoint" "main" {
  workspace_id     = oai_workspace.main.id
  orchestration_id = oai_orchestration.main.id
  agent_id         = oai_agent.main.id
  description      = "My endpoint"
  endpoint         = "/my-endpoint"
}

# ── Link ──────────────────────────────────────────────────────────────────────

resource "oai_link" "main" {
  workspace_id     = oai_workspace.main.id
  orchestration_id = oai_orchestration.main.id
  agent_id         = oai_agent.main.id
  link_name        = "my-link"
  link_description = "My link"
  link_url         = "https://example.com/link"
}

# ── Setting ───────────────────────────────────────────────────────────────────

resource "oai_setting" "main" {
  workspace_id        = oai_workspace.main.id
  orchestration_id    = oai_orchestration.main.id
  agent_id            = oai_agent.main.id
  setting_name        = "my-setting"
  setting_description = "My setting"
  setting_type        = "text"
  text_value          = "hello"
  boolean_value       = false
}

# ── Task ──────────────────────────────────────────────────────────────────────

resource "oai_task" "main" {
  workspace_id     = oai_workspace.main.id
  orchestration_id = oai_orchestration.main.id
  agent_id         = oai_agent.main.id
  message          = "my task message"
  cron_expression  = "0 9 * * 1-5"
}

# ── LLM key ───────────────────────────────────────────────────────────────────

resource "oai_llm_key" "main" {
  client_id     = var.oai_llm_client_id
  client_secret = var.oai_llm_client_secret
  llm_provider  = "OpenAI"
}

variable "oai_llm_client_id"     {}
variable "oai_llm_client_secret" { sensitive = true }

# ── Access ────────────────────────────────────────────────────────────────────

resource "oai_access" "main" {
  principal_id    = "<principal-id>"
  principal_name  = "<principal-name>"
  principal_email = "<principal-email>"
  resource_id     = oai_workspace.main.id
  role            = "viewer"
}

# ── Ticker config — workspace scope ───────────────────────────────────────────

resource "oai_ticker_config" "workspace" {
  scope           = "workspace"
  workspace_id    = oai_workspace.main.id
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
  workspace_id     = oai_workspace.main.id
  orchestration_id = oai_orchestration.main.id
  agent_id         = oai_agent.main.id
  enabled          = true
  cadence_minutes  = 30
  inherit          = true
}

# ── Storage dir ───────────────────────────────────────────────────────────────

resource "oai_storage_dir" "main" {
  scope            = "agent"
  workspace_id     = oai_workspace.main.id
  orchestration_id = oai_orchestration.main.id
  agent_id         = oai_agent.main.id
  path             = "config"
}

# ── Storage file ──────────────────────────────────────────────────────────────

resource "oai_storage_file" "main" {
  scope            = "agent"
  workspace_id     = oai_workspace.main.id
  orchestration_id = oai_orchestration.main.id
  agent_id         = oai_agent.main.id
  path             = "config/settings.json"
  content          = jsonencode({ environment = "production" })

  depends_on = [oai_storage_dir.main]
}
