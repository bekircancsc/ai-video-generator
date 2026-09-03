# Starts n8n with the two settings the publishing workflow cannot run without.
#
# Neither is a preference. Started bare, n8n comes up looking healthy and the
# workflow is quietly broken in two different places, so start it from here
# rather than by typing `n8n start`.

# Execute Command is excluded by default. n8n ships
# NODES_EXCLUDE = ["n8n-nodes-base.executeCommand", "n8n-nodes-base.localFileTrigger"],
# and an excluded node is not merely disabled — the editor never receives its
# type, so the Render node draws as a grey "?" and the whole canvas goes
# read-only. Nothing says why. Overriding the list is the only way to get the
# node back, and the override replaces the default wholesale, which is why
# localFileTrigger has to be named again here: we want that one to stay out.
$env:NODES_EXCLUDE = '["n8n-nodes-base.localFileTrigger"]'

# Where n8n is allowed to read. The render writes to `out/` inside the repo,
# which is under OneDrive and far outside anything n8n should be able to touch,
# so the CLI's --stage flag drops a copy here and the file nodes read that.
# Unset, this restriction is not merely relaxed, it is absent — n8n will read
# anything the user can.
$env:N8N_RESTRICT_FILE_ACCESS_TO = 'C:\n8n-data'

# n8n needs Node 24 on Windows. Under 22 and 23 every file read fails with
# "The file has changed and cannot be accessed" — see docs/n8n-setup.md for why.
$nodeVersion = (node --version) -replace '^v', ''
$major = [int]($nodeVersion -split '\.')[0]
if ($major -lt 24) {
    Write-Error "n8n needs Node 24 or newer; this shell has $nodeVersion. Run 'nvm use 24.11.1' first."
    exit 1
}

Write-Host "Starting n8n on Node $nodeVersion with Execute Command enabled." -ForegroundColor Green
n8n start
