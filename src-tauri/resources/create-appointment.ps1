# CalView — Create Outlook Appointment via COM Automation
#
# This script creates an Outlook meeting request and opens the appointment
# dialog for the user to review and send. It does NOT send the meeting
# automatically — the user must click "Send" in Outlook.
#
# Parameters are read from a JSON file whose path is passed as the single
# command-line argument. This avoids all quoting/escaping issues that occur
# when passing strings with spaces, special characters, or empty values
# through process argument lists.
#
# Expected JSON structure:
#   {
#     "subject": "...",
#     "start": "2026-04-13 14:00",
#     "duration": 60,
#     "location": "...",
#     "body": "...",
#     "attendees": ["Name One", "Name Two"]
#   }
#
# Logging goes to %TEMP%\calview-outlook.log for debugging.
#
# Exit codes:
#   0 = success (dialog was displayed)
#   1 = error (Outlook not installed, COM failure, etc.)

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$ParamsFile
)

# ─── Logging ─────────────────────────────────────────────────────────────────

$logFile = Join-Path $env:TEMP "calview-outlook.log"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"
    $line = "$timestamp  $Message"
    try {
        $line | Out-File -Append -FilePath $logFile -Encoding utf8
    } catch {
        # If logging itself fails, silently continue — we don't want
        # a logging error to mask the real error.
    }
}

# ─── Read parameters from JSON file ─────────────────────────────────────────

Write-Log "========================================"
Write-Log "=== START create-appointment.ps1 ==="
Write-Log "========================================"
Write-Log "PowerShell version: $($PSVersionTable.PSVersion)"
Write-Log "Script path:        $PSCommandPath"
Write-Log "Params file:        $ParamsFile"
Write-Log "Log file:           $logFile"

if (-not (Test-Path $ParamsFile)) {
    Write-Log "ERROR: Params file not found: $ParamsFile"
    Write-Error "Parameter-Datei nicht gefunden: $ParamsFile"
    exit 1
}

try {
    $rawJson = Get-Content -Path $ParamsFile -Raw -Encoding utf8
    Write-Log "Raw JSON content: $rawJson"
    $params = $rawJson | ConvertFrom-Json
    Write-Log "JSON parsed successfully"
} catch {
    Write-Log "ERROR: Failed to read/parse JSON file: $($_.Exception.Message)"
    Write-Error "JSON-Datei konnte nicht gelesen werden: $($_.Exception.Message)"
    exit 1
}

# Extract parameters with defaults
$Subject   = if ($params.subject)  { $params.subject }  else { "" }
$Start     = if ($params.start)    { $params.start }    else { "" }
$Duration  = if ($params.duration) { [int]$params.duration } else { 60 }
$Location  = if ($params.location) { $params.location } else { "" }
$Body      = if ($params.body)     { $params.body }     else { "" }
$Attendees = @()
if ($params.attendees -and $params.attendees.Count -gt 0) {
    $Attendees = @($params.attendees)
}

Write-Log "Parameters extracted:"
Write-Log "  Subject    = '$Subject'"
Write-Log "  Start      = '$Start'"
Write-Log "  Duration   = $Duration"
Write-Log "  Location   = '$Location'"
Write-Log "  Body       = '$Body'"
Write-Log "  Attendees  = [$($Attendees -join '; ')]  (count: $($Attendees.Count))"

# ─── Main ────────────────────────────────────────────────────────────────────

# Step 1: Create Outlook COM object
Write-Log "Step 1: Creating Outlook.Application COM object..."
try {
    $outlook = New-Object -ComObject Outlook.Application
    Write-Log "Step 1: OK — Outlook COM object created"
} catch {
    Write-Log "Step 1: FAILED — Could not create Outlook.Application COM object"
    Write-Log "  Error: $($_.Exception.Message)"
    Write-Log "  This usually means Outlook is not installed."
    Write-Error "Outlook ist nicht installiert oder konnte nicht gestartet werden: $($_.Exception.Message)"
    exit 1
}

# Step 2: Create appointment item
Write-Log "Step 2: Creating appointment item..."
try {
    $appointment = $outlook.CreateItem(1)  # 1 = olAppointmentItem
    Write-Log "Step 2: OK — Appointment item created"
} catch {
    Write-Log "Step 2: FAILED — Could not create appointment item"
    Write-Log "  Error: $($_.Exception.Message)"
    Write-Error "Termin konnte nicht erstellt werden: $($_.Exception.Message)"
    exit 1
}

# Step 3: Set meeting status (olMeeting = 1)
Write-Log "Step 3: Setting MeetingStatus = 1 (olMeeting)..."
try {
    $appointment.MeetingStatus = 1
    Write-Log "Step 3: OK"
} catch {
    Write-Log "Step 3: FAILED — $($_.Exception.Message)"
    # Non-fatal: continue without meeting status
}

# Step 4: Set basic fields
Write-Log "Step 4: Setting basic appointment fields..."
try {
    if ($Subject) {
        $appointment.Subject = $Subject
        Write-Log "  Subject set"
    }

    if ($Start) {
        $parsedStart = [DateTime]::ParseExact($Start, "yyyy-MM-dd HH:mm", [System.Globalization.CultureInfo]::InvariantCulture)
        $appointment.Start = $parsedStart
        Write-Log "  Start set to $parsedStart"
    } else {
        Write-Log "  Start not provided — using Outlook default"
    }

    $appointment.Duration = $Duration
    Write-Log "  Duration set to $Duration minutes"

    if ($Location) {
        $appointment.Location = $Location
        Write-Log "  Location set"
    }

    if ($Body) {
        $appointment.Body = $Body
        Write-Log "  Body set"
    }

    Write-Log "Step 4: OK — All basic fields set"
} catch {
    Write-Log "Step 4: FAILED — Error setting fields"
    Write-Log "  Error: $($_.Exception.Message)"
    Write-Log "  Stack: $($_.ScriptStackTrace)"
    Write-Error "Terminfelder konnten nicht gesetzt werden: $($_.Exception.Message)"
    exit 1
}

# Step 5: Add attendees (recipients)
Write-Log "Step 5: Adding attendees..."
if ($Attendees.Count -gt 0) {
    try {
        $addedCount = 0
        foreach ($attendee in $Attendees) {
            $trimmed = "$attendee".Trim()
            if ($trimmed) {
                $recipient = $appointment.Recipients.Add($trimmed)
                # Type 1 = olRequired
                $recipient.Type = 1
                $addedCount++
                Write-Log "  Added recipient: '$trimmed'"
            }
        }
        Write-Log "  Total recipients added: $addedCount"

        if ($addedCount -gt 0) {
            Write-Log "  Calling ResolveAll()..."
            $resolved = $appointment.Recipients.ResolveAll()
            Write-Log "  ResolveAll() returned: $resolved"
            if (-not $resolved) {
                Write-Log "  WARNING: Not all recipients could be resolved. The user will see unresolved names in the dialog."
            }
        }

        Write-Log "Step 5: OK"
    } catch {
        Write-Log "Step 5: FAILED — Error adding attendees"
        Write-Log "  Error: $($_.Exception.Message)"
        Write-Log "  Stack: $($_.ScriptStackTrace)"
        # Non-fatal: continue without attendees, the dialog will still open
        Write-Log "  Continuing without attendees..."
    }
} else {
    Write-Log "Step 5: Skipped — no attendees provided"
}

# Step 6: Display the appointment dialog
Write-Log "Step 6: Calling Display() to open the Outlook dialog..."
try {
    $appointment.Display()
    Write-Log "Step 6: OK — Dialog displayed successfully"
} catch {
    Write-Log "Step 6: FAILED — Could not display dialog"
    Write-Log "  Error: $($_.Exception.Message)"
    Write-Log "  Stack: $($_.ScriptStackTrace)"
    Write-Error "Outlook-Dialog konnte nicht geoeffnet werden: $($_.Exception.Message)"
    exit 1
}

Write-Log "=== END create-appointment.ps1 (success) ==="
Write-Log "========================================"

# Clean up the params file (best-effort, non-fatal)
try {
    Remove-Item -Path $ParamsFile -Force -ErrorAction SilentlyContinue
    Write-Log "Cleaned up params file: $ParamsFile"
} catch {
    Write-Log "WARNING: Could not clean up params file: $($_.Exception.Message)"
}
