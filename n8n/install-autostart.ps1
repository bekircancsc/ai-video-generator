# Registers a Windows scheduled task that brings n8n up at logon.
#
# The publishing workflow is a cron inside n8n, and n8n is an ordinary program:
# a schedule that fires while it is not running does not fire at all, and
# nothing catches up afterwards — n8n's schedule trigger registers a cron and
# has no missed-run handling of any kind. So the machine being on has to be
# enough on its own; remembering to open a terminal cannot be part of it.
#
# What this does NOT fix: a machine that is switched off when the video is due.
# Nothing running locally can. The arc still does not lose an episode, because
# --series picks the next unpublished part from history.json rather than from
# the calendar, so a missed day shifts the run rather than skipping a part.
#
# Run once:
#     .\n8n\install-autostart.ps1
#
# Undo:
#     .\n8n\install-autostart.ps1 -Remove

param(
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$taskName = 'n8n publishing'
$repoRoot = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $PSScriptRoot 'start-n8n.ps1'
$logFile = Join-Path $env:LOCALAPPDATA 'n8n-autostart.log'

if ($Remove) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "Removed the '$taskName' task. n8n will no longer start at logon."
    }
    else {
        Write-Host "No '$taskName' task registered; nothing to remove."
    }
    return
}

if (-not (Test-Path $startScript)) {
    throw "Cannot find $startScript"
}

# -NoProfile so a slow or broken profile cannot stall the start; -Hidden because
# this runs unattended and a console window at every logon is noise. The window
# being hidden is why start-n8n.ps1 takes -LogFile: without it a failed start
# would leave nothing to read.
$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`" -LogFile `"$logFile`"" `
    -WorkingDirectory $repoRoot

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# n8n is long-running by design, so nothing here may treat it as a job that
# ought to finish: no execution time limit, and no second copy if the task is
# somehow triggered again. StartWhenAvailable covers a logon that happened while
# the machine was still settling.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

# Run as the logged-on user, not SYSTEM: the workflow renders into this user's
# OneDrive path, reads this user's n8n database, and holds this user's
# credentials. SYSTEM would see none of it.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Starts n8n so the daily publishing workflow can fire. See n8n/install-autostart.ps1.' `
    -Force | Out-Null

Write-Host "Registered '$taskName'." -ForegroundColor Green
Write-Host "  starts : $startScript"
Write-Host "  log    : $logFile"
Write-Host "  when   : at logon for $env:USERNAME"
Write-Host ""
Write-Host "Start it now without logging out:  Start-ScheduledTask -TaskName '$taskName'"
