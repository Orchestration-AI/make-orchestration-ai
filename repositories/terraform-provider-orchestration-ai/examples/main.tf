terraform {
  required_providers {
    orchestration_ai = {
      source  = "orchestration-ai/orchestration-ai"
      version = "~> 0.1"
    }
  }
}

provider "orchestration_ai" {
  # client_id and client_secret can also be set via:
  #   ORCHESTRATION_AI_CLIENT_ID
  #   ORCHESTRATION_AI_CLIENT_SECRET
  client_id     = var.oai_client_id
  client_secret = var.oai_client_secret
}

variable "oai_client_id" { sensitive = true }
variable "oai_client_secret" { sensitive = true }

# ── Workspace ────────────────────────────────────────────────────────────────

resource "orchestration_ai_workspace" "main" {
  workspace_name = "my-workspace"
}

# ── Orchestration ─────────────────────────────────────────────────────────────

resource "orchestration_ai_orchestration" "main" {
  workspace_id              = orchestration_ai_workspace.main.id
  orchestration_name        = "my-orchestration"
  orchestration_description = "Does the thing"
}

# ── Agent ─────────────────────────────────────────────────────────────────────

resource "orchestration_ai_agent" "main" {
  workspace_id      = orchestration_ai_workspace.main.id
  orchestration_id  = orchestration_ai_orchestration.main.id
  agent_name        = "my-agent"
  agent_description = "Handles the thing"
  vm_enabled        = true
}

# ── Ticker config (agent-scoped) ──────────────────────────────────────────────

resource "orchestration_ai_ticker_config" "agent" {
  scope            = "agent"
  workspace_id     = orchestration_ai_workspace.main.id
  orchestration_id = orchestration_ai_orchestration.main.id
  agent_id         = orchestration_ai_agent.main.id
  enabled          = true
  cadence_minutes  = 60
  inherit          = false

  work_hours {
    monday    { start = 9  end = 17 }
    tuesday   { start = 9  end = 17 }
    wednesday { start = 9  end = 17 }
    thursday  { start = 9  end = 17 }
    friday    { start = 9  end = 17 }
    # saturday and sunday omitted — no work on weekends
  }
}

# ── Storage file (agent-scoped) ───────────────────────────────────────────────

resource "orchestration_ai_storage_file" "config" {
  scope            = "agent"
  workspace_id     = orchestration_ai_workspace.main.id
  orchestration_id = orchestration_ai_orchestration.main.id
  agent_id         = orchestration_ai_agent.main.id
  path             = "config/settings.json"
  content          = jsonencode({ environment = "production" })
}
