# Starts n8n with the two settings the publishing workflow cannot run without.
#
# Neither is a preference. Started bare, n8n comes up looking healthy and the
# workflow is quietly broken in two different places, so start it from here
# rather than by typing `n8n start`.
#
# Run by hand, or at logon by the task that n8n/install-autostart.ps1 registers.

param(
    # Where to append startup output. The autostart task runs with no window, so
    # without this a failed start leaves nothing behind to read.
    [string]$LogFile
)

if ($LogFile) {
    $logDir = Split-Path -Parent $LogFile
    if ($logDir -and -not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    }
    Start-Transcript -Path $LogFile -Append | Out-Null
}

# Already up? Two instances cannot share port 5678, and the second dies with a
# confusing bind error that looks like a broken install. This matters most at
# logon, where the task fires whether or not n8n is already running.
$listening = Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue
if ($listening) {
    Write-Host "n8n is already listening on 5678 (PID $($listening[0].OwningProcess)). Nothing to do."
    if ($LogFile) { Stop-Transcript | Out-Null }
    exit 0
}

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
#
# `nvm use` repoints C:\nvm4w\nodejs for the whole machine, so switching Node
# for another project silently breaks the nightly publish. That is exactly the
# failure this check exists to make loud.
$nodeVersion = (node --version) -replace '^v', ''
$major = [int]($nodeVersion -split '\.')[0]
if ($major -lt 24) {
    Write-Error "n8n needs Node 24 or newer; this shell has $nodeVersion. Run 'nvm use 24.11.1' first."
    if ($LogFile) { Stop-Transcript | Out-Null }
    exit 1
}

Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') starting n8n on Node $nodeVersion with Execute Command enabled."
n8n start
