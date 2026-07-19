# Live smoke test for the AI interpret pipeline. Creates a throwaway user,
# seeds one routine/task and one open reminder, sends canonical messages
# through the DEPLOYED interpret-message function, asserts the results, and
# deletes the user again (FK cascade removes every row it created).
#
# Run it after deploying interpret-message:
#   powershell -File scripts/smoke-test.ps1
#
# Auth: reads the Supabase CLI's management token from Windows Credential
# Manager (target "Supabase CLI:supabase" - created by `supabase login`).
# Nothing secret is ever printed.

param(
  [string]$ProjectRef = 'cczldxlrkiuctvwuibbs',
  [string]$Timezone = 'Romance Standard Time' # Windows id for Europe/Madrid
)

$ErrorActionPreference = 'Stop'

# --- management token from Windows Credential Manager -----------------------
$sig = @'
using System;
using System.Runtime.InteropServices;
public class SmokeCred {
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
}
'@
if (-not ([System.Management.Automation.PSTypeName]'SmokeCred').Type) { Add-Type -TypeDefinition $sig }
$ptr = [IntPtr]::Zero
if (-not [SmokeCred]::CredRead('Supabase CLI:supabase', 1, 0, [ref]$ptr)) {
  throw 'Supabase CLI token not found in Credential Manager - run `supabase login` first.'
}
$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][SmokeCred+CREDENTIAL])
$blob = New-Object 'byte[]' ($cred.CredentialBlobSize)
[System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $blob, 0, $cred.CredentialBlobSize)
$mgmt = [System.Text.Encoding]::UTF8.GetString($blob).Trim([char]0).Trim()

# --- project keys ------------------------------------------------------------
$keys = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ProjectRef/api-keys" -Headers @{ Authorization = "Bearer $mgmt" }
$anon = ($keys | Where-Object { $_.name -eq 'anon' }).api_key
$service = ($keys | Where-Object { $_.name -eq 'service_role' }).api_key
$base = "https://$ProjectRef.supabase.co"
$sqlUri = "https://api.supabase.com/v1/projects/$ProjectRef/database/query"

function Invoke-Sql($q) {
  Invoke-RestMethod -Method Post -Uri $sqlUri -Headers @{ Authorization = "Bearer $mgmt" } -ContentType 'application/json' -Body (@{ query = $q } | ConvertTo-Json)
}

# --- throwaway user + seed ----------------------------------------------------
$email = "smoke-$([guid]::NewGuid().ToString('N').Substring(0,8))@example.com"
$pw = 'Tmp-' + [guid]::NewGuid().ToString('N').Substring(0, 20)
$u = Invoke-RestMethod -Method Post -Uri "$base/auth/v1/admin/users" -Headers @{ apikey = $service; Authorization = "Bearer $service" } -ContentType 'application/json' -Body (@{ email = $email; password = $pw; email_confirm = $true } | ConvertTo-Json)
$uid = $u.id
Write-Output "throwaway user: $uid ($email)"

$failures = 0
try {
  [void](Invoke-Sql @"
with r as (insert into routines (user_id, name, category, sort_order, active) values ('$uid','Cleaning','home',0,true) returning id)
insert into tasks (routine_id, label, sort_order, tier, scheduled_days) select id, 'Dishes', 0, 'core', '{1,2,3,4,5,6,7}' from r;
insert into reminders (user_id, raw_text, final_category, status) values ('$uid','Buy sunscreen body lotion','Other','reassigned');
"@)

  $login = Invoke-RestMethod -Method Post -Uri "$base/auth/v1/token?grant_type=password" -Headers @{ apikey = $anon } -ContentType 'application/json' -Body (@{ email = $email; password = $pw } | ConvertTo-Json)
  $hdrs = @{ apikey = $anon; Authorization = "Bearer $($login.access_token)" }
  $now = [System.TimeZoneInfo]::ConvertTime([datetime]::UtcNow, [System.TimeZoneInfo]::FindSystemTimeZoneById($Timezone))
  $isoWeekday = if ($now.DayOfWeek.value__ -eq 0) { 7 } else { $now.DayOfWeek.value__ }

  function Send-Msg($t) {
    $b = @{ text = $t; date = $now.ToString('yyyy-MM-dd'); weekday = $isoWeekday; time = $now.ToString('HH:mm') } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "$base/functions/v1/interpret-message" -Headers $hdrs -ContentType 'application/json' -Body $b
  }
  function Assert($name, $cond, $detail) {
    if ($cond) { Write-Output "PASS  $name" }
    else { Write-Output "FAIL  $name  ($detail)"; $script:failures++ }
  }

  # NB: pipelines are wrapped in @(...) - PS 5.1 collapses one-item results
  # to a scalar, which silently breaks .Count and [0]

  # 1. relative time
  $expected = $now.AddMinutes(10).ToString('HH:mm')
  $r = Send-Msg 'remind me to drink water in 10 mins'
  $a = @(@($r.applied) | Where-Object { $_.type -eq 'create_reminder' })
  Assert 'in-10-mins reminder' ($a.Count -eq 1 -and $a[0].due_time -eq $expected -and $a[0].due_date -eq $now.ToString('yyyy-MM-dd')) ($a | ConvertTo-Json -Compress)

  # 2. tomorrow + pm time, no client clock sent
  $b2 = @{ text = 'remind me to call the bank tomorrow at 5pm'; date = $now.ToString('yyyy-MM-dd'); weekday = $isoWeekday } | ConvertTo-Json
  $r2 = Invoke-RestMethod -Method Post -Uri "$base/functions/v1/interpret-message" -Headers $hdrs -ContentType 'application/json' -Body $b2
  $a2 = @(@($r2.applied) | Where-Object { $_.type -eq 'create_reminder' })
  Assert 'tomorrow-5pm reminder' ($a2.Count -eq 1 -and $a2[0].due_time -eq '17:00' -and $a2[0].due_date -eq $now.AddDays(1).ToString('yyyy-MM-dd')) ($a2 | ConvertTo-Json -Compress)

  # 3. clear an open reminder by saying it happened
  $r3 = Send-Msg 'I bought the sunscreen'
  $a3 = @(@($r3.applied) | Where-Object { $_.type -eq 'complete_reminder' })
  Assert 'clear reminder' ($a3.Count -eq 1 -and $a3[0].reminder_status -eq 'done') ($r3.applied | ConvertTo-Json -Compress)

  # 4. cardio with bpm, exactly once
  $r4 = Send-Msg 'cycled 12km in 40 min at 139 bpm'
  $a4 = @(@($r4.applied) | Where-Object { $_.type -eq 'log_cardio' })
  Assert 'cardio once with bpm' ($a4.Count -eq 1 -and $a4[0].avg_hr -eq 139 -and $a4[0].distance_km -eq 12) ($r4.applied | ConvertTo-Json -Compress)

  # 5. past-day check
  $r5 = Send-Msg 'I did the dishes yesterday'
  $a5 = @(@($r5.applied) | Where-Object { $_.type -eq 'check_task' })
  Assert 'yesterday task' ($a5.Count -eq 1 -and $a5[0].log_date -eq $now.AddDays(-1).ToString('yyyy-MM-dd')) ($r5.applied | ConvertTo-Json -Compress)
} finally {
  Invoke-RestMethod -Method Delete -Uri "$base/auth/v1/admin/users/$uid" -Headers @{ apikey = $service; Authorization = "Bearer $service" } | Out-Null
  Write-Output 'throwaway user deleted (cascade cleans its rows)'
}

if ($failures -gt 0) { Write-Output "$failures FAILURE(S)"; exit 1 }
Write-Output 'all smoke tests passed'
