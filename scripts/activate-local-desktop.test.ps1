param([Parameter(Mandatory)][string]$WorkerPath, [string]$NodeExecutable = 'node.exe')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'activate-local-desktop.ps1')
function Assert($condition, $message) { if (-not $condition) { throw $message } }
function Must-Fail($action) {
  $failed = $false
  try { & $action } catch { $failed = $true }
  Assert $failed 'Expected failure'
}
$root = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $root | Out-Null
try {
  foreach ($mode in @('Preflight', 'Prepare', 'Launch', 'Activate')) {
    foreach ($failure in @('config', 'startup')) {
      $fixture = Join-Path $root ("early-$mode-$failure")
      New-Item -ItemType Directory -Path $fixture | Out-Null
      $configPath = Join-Path $fixture 'config.json'
      if ($failure -eq 'config') { Set-Content $configPath '{invalid' }
      else { @{ install = (Join-Path $fixture 'installed'); checkOnly = $true } | ConvertTo-Json | Set-Content $configPath }
      Must-Fail { Invoke-LocalDesktopUpdate $configPath $mode }
      $receipt = Get-Content (Join-Path $fixture 'receipt.json') -Raw | ConvertFrom-Json
      Assert ($receipt.status -eq 'failed' -and $receipt.error) "$mode early $failure failure lost its terminal receipt"
      Write-Host "PASS case: early-$mode-$failure"
    }
  }
  $clock = @{ now = [DateTime]'2026-01-01T00:00:00Z'; reads = 0; delays = 0 }
  $result = Wait-LocalUpdateDrain 0 { throw 'Zero drain must not read' }
  Assert ($result.reason -eq 'deadline') 'Zero drain did not skip'
  $result = Wait-LocalUpdateDrain 5 { $clock.reads++; @{ idle = $false } } { $clock.now } { param($seconds) $clock.now = $clock.now.AddSeconds($seconds); $clock.delays++ }
  Assert ($result.reason -eq 'deadline' -and $clock.reads -eq 60 -and $clock.delays -eq 60) 'Drain did not stop at five minutes'
  $result = Wait-LocalUpdateDrain 5 { @{ idle = $true } } { $clock.now } { throw 'Idle drain must not wait' }
  Assert ($result.reason -eq 'idle') 'Idle drain failed'
  $clock.now = [DateTime]'2026-01-01T00:00:00Z'
  $result = Wait-LocalUpdateDrain 1 { $clock.now = $clock.now.AddSeconds(65); @{ idle = $false } } { $clock.now } { throw 'Read over deadline must not add a wait' }
  Assert ($result.reason -eq 'deadline') 'Slow drain read ignored deadline'

  $clock.now = [DateTime]'2026-01-01T00:00:00Z'
  $clock.reads = 0
  $clock.authentications = 0
  $result = Wait-LocalUpdateLinks 5 {
    param($remaining, $authenticate)
    if ($authenticate) { $clock.authentications++; Assert ($clock.reads -eq 2) 'Authenticated before both identities answered' }
    else { $clock.reads++ }
    @{ wslToWindows = @{ status = 'passed' }; windowsToWsl = @{ status = $(if ($clock.reads -eq 1) { 'warning' } else { 'passed' }) } }
  } { $clock.now } { param($seconds) $clock.now = $clock.now.AddSeconds($seconds) }
  Assert ($result.status -eq 'passed' -and $clock.reads -eq 2 -and $clock.authentications -eq 1) 'Link check did not wait for both identities before authenticating once'
  $clock.authentications = 0
  $result = Wait-LocalUpdateLinks 3 {
    param($remaining, $authenticate)
    if ($authenticate) { $clock.authentications++ }
    @{ wslToWindows = @{ status = 'passed' }; windowsToWsl = @{ status = $(if ($authenticate) { 'warning' } else { 'passed' }); error = 'Credential refused' } }
  } { $clock.now } { param($seconds) $clock.now = $clock.now.AddSeconds($seconds) }
  Assert ($result.status -eq 'warning' -and $result.windowsToWsl.error -eq 'Credential refused' -and $clock.authentications -eq 1) 'Authentication failure lost its directional warning or retried'
  $result = Wait-LocalUpdateLinks 3 {
    param($remaining, $authenticate)
    Assert (-not $authenticate) 'Authenticated before unreachable peer answered'
    @{ wslToWindows = @{ status = 'passed' }; windowsToWsl = @{ status = 'warning'; error = 'Starting' } }
  } { $clock.now } { param($seconds) $clock.now = $clock.now.AddSeconds($seconds) }
  Assert ($result.status -eq 'warning' -and $result.windowsToWsl.error -eq 'Starting') 'Link deadline lost its directional warning'
  $result = Wait-LocalUpdateLinks 1 { throw 'Probe startup failed' } { $clock.now } { param($seconds) $clock.now = $clock.now.AddSeconds($seconds) }
  Assert ($result.status -eq 'warning' -and $result.error -eq 'Probe startup failed') 'Link exception escaped as an activation failure'

  foreach ($case in @('healthy', 'unhealthy', 'promotion-failed', 'close-refused')) {
    $fixture = Join-Path $root $case
    $install = Join-Path $fixture 'installed'
    $payload = Join-Path $fixture 'payload'
    $rollback = Join-Path $fixture 'rollback'
    New-Item -ItemType Directory -Path $install,$payload,$rollback | Out-Null
    Set-Content (Join-Path $install 'version') 'old'
    Set-Content (Join-Path $payload 'version') 'new'
    $calls = @{ starts = 0; closes = 0 }
    $start = { $calls.starts++ }
    $healthy = { $case -eq 'healthy' }
    $close = { $calls.closes++; if ($case -eq 'close-refused') { throw 'Refused graceful close' } }
    if ($case -eq 'promotion-failed') {
      function Move-Item {
        param($LiteralPath, $Destination)
        if ($LiteralPath -eq $payload) { throw 'Fixture promotion failure' }
        Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination
      }
    }
    try {
      if ($case -eq 'healthy') { Invoke-LocalUpdateSwap $install $payload $rollback $start $healthy $close }
      else { Must-Fail { Invoke-LocalUpdateSwap $install $payload $rollback $start $healthy $close } }
    } finally { if ($case -eq 'promotion-failed') { Remove-Item Function:Move-Item } }
    if ($case -eq 'healthy') {
      Assert ((Get-Content (Join-Path $install 'version')) -eq 'new') 'Healthy candidate not installed'
      Assert ((Get-Content (Join-Path $rollback 'app/version')) -eq 'old') 'Rollback lost old application'
      Assert ($calls.starts -eq 1 -and $calls.closes -eq 0) 'Healthy candidate rolled back'
    } elseif ($case -eq 'close-refused') {
      Assert ((Get-Content (Join-Path $install 'version')) -eq 'new') 'Moved a candidate that refused close'
      Assert ((Get-Content (Join-Path $rollback 'app/version')) -eq 'old') 'Lost rollback after refused close'
    } else {
      Assert ((Get-Content (Join-Path $install 'version')) -eq 'old') 'Failure did not restore previous application'
      Assert (-not (Test-Path (Join-Path $rollback 'app'))) 'Restored application still in rollback slot'
      if ($case -eq 'unhealthy') {
        Assert ((Get-Content (Join-Path $payload 'version')) -eq 'new') 'Lost failed candidate'
        Assert ($calls.closes -eq 1 -and $calls.starts -eq 1) 'Rollback did not close the failed candidate'
      }
    }
    Write-Host "PASS case: swap-$case"
  }
  $calls = @{ operations = @() }
  $result = Invoke-LocalUpdateWsl 'fixture-distro' @('fixture-command') 'health' 5 {
    param($executable, $arguments, $label, $seconds)
    $calls.operations += $label
    Assert ($seconds -gt 0 -and $seconds -le 5) 'Probe exceeded its operation budget'
    if ($label -eq 'health') { @{ healthy = $true } }
  }
  Assert ($result.healthy -and ($calls.operations -join ',') -eq 'wsl-responsive,health') 'WSL operation ran without its responsiveness probe'
  $calls.operations = @()
  Must-Fail {
    Invoke-LocalUpdateWsl 'fixture-distro' @('fixture-command') 'health' 5 {
      param($executable, $arguments, $label, $seconds)
      $calls.operations += $label
      throw 'Wsl/Service/WSAETIMEDOUT'
    }
  }
  Assert (($calls.operations -join ',') -eq 'wsl-responsive') 'Unresponsive WSL still received the operation'
  foreach ($case in @('healthy', 'unhealthy', 'stop-failed', 'promotion-failed')) {
    $fixture = Join-Path $root ('runtime-' + $case)
    $resources = Join-Path $fixture 'resources'
    New-Item -ItemType Directory -Path $resources | Out-Null
    Set-Content (Join-Path $resources 'wsl-runtime.tar.gz') 'previous-archive'
    Set-Content (Join-Path $resources 'wsl-runtime.tar.gz.sha256') 'previous-digest'
    $archive = Join-Path $fixture 'candidate.tar.gz'
    Set-Content $archive 'new-archive'
    $calls = @{ stops = 0; recoveries = 0 }
    $stop = { $calls.stops++; if ($case -eq 'stop-failed') { throw 'WSL went away' } }
    $healthy = { $case -eq 'healthy' }
    $recover = { $calls.recoveries++ }
    if ($case -eq 'promotion-failed') {
      function Move-Item {
        param($LiteralPath, $Destination, [switch]$Force)
        if ($LiteralPath.EndsWith('.sha256.next')) { throw 'Hash promotion failed' }
        Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force
      }
    }
    try {
      if ($case -eq 'healthy') { Invoke-LocalRuntimeUpdate $resources $archive 'new-digest' (Join-Path $fixture 'rollback') $stop $healthy $recover }
      else { Must-Fail { Invoke-LocalRuntimeUpdate $resources $archive 'new-digest' (Join-Path $fixture 'rollback') $stop $healthy $recover } }
    } finally { if ($case -eq 'promotion-failed') { Remove-Item Function:Move-Item } }
    $expected = $(if ($case -eq 'healthy') { 'new' } else { 'previous' })
    Assert ((Get-Content (Join-Path $resources 'wsl-runtime.tar.gz')) -eq ($expected + '-archive')) 'Runtime archive was not restored with its digest'
    Assert ((Get-Content (Join-Path $resources 'wsl-runtime.tar.gz.sha256')) -eq ($expected + '-digest')) 'Runtime digest did not match its archive'
    Assert ((Get-Content (Join-Path $fixture 'rollback/wsl-runtime.tar.gz.sha256')) -eq 'previous-digest') 'Previous runtime selection was lost'
    Assert ($calls.stops -eq $(if ($case -eq 'promotion-failed') { 0 } else { 1 })) 'Stopped server before promoting both files'
    Assert ($calls.recoveries -eq $(if ($case -in @('unhealthy', 'stop-failed')) { 1 } else { 0 })) 'Runtime recovery was skipped after stopping'
    Write-Host "PASS case: runtime-selection-$case"
  }
  foreach ($case in @('stopped-throws', 'close-late-exit', 'health-transient', 'runtime-no-desktop', 'runtime-backup', 'runtime-recovery', 'runtime-recovery-late-exit')) {
    $fixture = Join-Path $root ('activation-' + $case)
    $install = Join-Path $fixture 'installed'
    $resources = Join-Path $install 'resources'
    $rollback = Join-Path $fixture '.installed-local-update-rollback'
    $candidate = Join-Path $fixture '.installed-candidate'
    $payload = Join-Path $candidate 'payload'
    $backupRoot = Join-Path $fixture 'state'
    New-Item -ItemType Directory -Path $resources,$payload,(Join-Path $payload 'resources'),(Join-Path $rollback 'app') | Out-Null
    Set-Content (Join-Path $resources 'wsl-runtime.tar.gz') 'old-archive'
    Set-Content (Join-Path $resources 'wsl-runtime.tar.gz.sha256') 'old-digest'
    Set-Content (Join-Path $install 'Weavewing.exe') 'fixture-shell'
    Set-Content (Join-Path $install 'Start Weavewing.cmd') 'fixture-launcher'
    Set-Content (Join-Path $payload 'Weavewing.exe') 'new-shell'
    Set-Content (Join-Path $payload 'resources/wsl-runtime.tar.gz') 'new-archive'
    Set-Content (Join-Path $payload 'Start Weavewing.cmd') 'fixture-launcher'
    Set-Content (Join-Path $candidate '.weavewing-stage-owner') $install
    Set-Content (Join-Path $rollback '.weavewing-update-owner') $install
    Set-Content (Join-Path $rollback 'app/previous') 'preserve'
    Copy-Item (Join-Path $PSScriptRoot 'stage-windows-desktop.ps1') (Join-Path $fixture 'stage-windows-desktop.ps1')
    $client = Join-Path $resources 'client'
    $clientSource = Join-Path $fixture 'client-source'
    New-Item -ItemType Directory -Path $client,$clientSource | Out-Null
    Set-Content (Join-Path $client 'index.html') 'old-client'
    Set-Content (Join-Path $client 'old-chunk.js') 'old-chunk'
    Set-Content (Join-Path $clientSource 'index.html') 'new-client'
    Set-Content (Join-Path $clientSource '.shell-version') '1.2.3'
    New-Item -ItemType Directory -Path (Join-Path $client 'assets'),(Join-Path $clientSource 'assets') | Out-Null
    Set-Content (Join-Path $client 'assets/old-chunk.js') 'old-nested'
    Set-Content (Join-Path $client 'assets/shared.js') 'old-shared'
    Set-Content (Join-Path $clientSource 'assets/shared.js') 'new-shared'
    Set-Content (Join-Path $clientSource 'assets/new-chunk.js') 'new-nested'
    $digest = (Get-FileHash (Join-Path $payload 'resources/wsl-runtime.tar.gz') -Algorithm SHA256).Hash.ToLowerInvariant()
    $oldDigest = (Get-FileHash (Join-Path $resources 'wsl-runtime.tar.gz') -Algorithm SHA256).Hash.ToLowerInvariant()
    $configPath = Join-Path $fixture 'config.json'
    $runtimeOnly = $case.StartsWith('runtime-')
    $config = @{ install = $install; updatePath = $(if ($runtimeOnly) { 'wsl-only' } else { 'full' }); archive = (Join-Path $payload 'resources/wsl-runtime.tar.gz'); digest = $digest; exeHash = (Get-FileHash (Join-Path $payload 'Weavewing.exe') -Algorithm SHA256).Hash.ToLowerInvariant(); checkOnly = $false; drainMinutes = 0; healthSeconds = 0.1; backupRootWindows = $backupRoot; clientSource = $clientSource; clientCommit = 'client-head'; clientAssetsDirectory = 'resources/client' }
    if ($case -in @('close-late-exit', 'runtime-recovery-late-exit')) { $config.closeSeconds = 0 }
    $config | ConvertTo-Json | Set-Content $configPath
    $invokeWsl = (Get-Item Function:Invoke-LocalUpdateWsl).ScriptBlock
    $calls = @{ operations = @(); starts = 0; sleeps = 0; closed = 0; health = 0 }
    function Get-Process {
      if ($case -in @('close-late-exit', 'runtime-recovery-late-exit')) {
        $process = [pscustomobject]@{ Path = (Join-Path $install 'Weavewing.exe'); Id = 100; MainWindowHandle = 123 }
        $process | Add-Member ScriptMethod CloseMainWindow { $calls.closed++; return $true }
        if ($calls.closed -eq 0 -or $calls.starts -gt 0 -or $calls.sleeps -lt 3) { $process }
      } elseif ($runtimeOnly -and $case -ne 'runtime-no-desktop') {
        $process = [pscustomobject]@{ Path = (Join-Path $install 'Weavewing.exe'); Id = 100; MainWindowHandle = 123 }
        $process | Add-Member ScriptMethod CloseMainWindow { $calls.closed++; return $true }
        if ($calls.closed -eq 0 -or $calls.starts -gt 0) { $process }
      }
    }
    function Start-Sleep { if ($calls.closed -gt 0) { $calls.sleeps++ } }
    function Start-Process {
      param($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle, [switch]$PassThru, $RedirectStandardInput, $RedirectStandardOutput, $RedirectStandardError, [switch]$NoNewWindow)
      if ($FilePath.EndsWith('Start Weavewing.cmd')) { $calls.starts++ }
      else {
        New-Item -ItemType Directory -Path (Join-Path $backupRoot 'backup-windows') | Out-Null
        Set-Content (Join-Path $backupRoot 'backup-windows/saved') 'state'
        @{ path = (Join-Path $backupRoot 'backup-windows') } | ConvertTo-Json | Set-Content $RedirectStandardOutput
      }
      $process = [pscustomobject]@{ Id = 999; Handle = 1; ExitCode = 0 }
      $process | Add-Member ScriptMethod WaitForExit { return $true }
      $process
    }
    function Invoke-LocalUpdateWsl {
      param($distro, $arguments, $label, $seconds, $Invoke)
      $calls.operations += $label
      if ($label -eq 'health') {
        $calls.health++
        if ($case -eq 'health-transient' -and $calls.health -eq 2) { throw 'One slow wsl call' }
        return @{ healthy = ($case -notin @('runtime-recovery', 'runtime-recovery-late-exit') -or $calls.health -eq 1 -or $calls.starts -gt 0); pid = 123; environmentId = 'fixture' }
      }
      if ($label -eq 'stopped' -and $case -eq 'stopped-throws') { throw 'WSL responsiveness failed after close' }
      if ($label -eq 'capture-links') { throw 'No links in fixture' }
      return @{ installed = $true; backedUp = $true; stopped = $true; path = 'fixture-wsl-backup' }
    }
    try {
      if ($case -in @('stopped-throws', 'close-late-exit', 'runtime-no-desktop', 'runtime-recovery', 'runtime-recovery-late-exit')) { Must-Fail { Invoke-LocalDesktopUpdate $configPath 'Activate' } }
      else { Invoke-LocalDesktopUpdate $configPath 'Activate' }
    } finally {
      Set-Item Function:Invoke-LocalUpdateWsl $invokeWsl
      Remove-Item Function:Get-Process,Function:Start-Process,Function:Start-Sleep
    }
    $receipt = Get-Content (Join-Path $fixture 'receipt.json') -Raw | ConvertFrom-Json
    if ($case -eq 'stopped-throws') {
      Assert ($receipt.status -eq 'failed' -and $calls.starts -eq 1 -and $receipt.rollbackHealthy) 'Stopped probe failure with an older rollback did not relaunch desktop'
      Assert (-not (Test-Path $backupRoot)) 'Failed update left a retry-blocking Windows backup'
      Assert (Test-Path (Join-Path $rollback 'app/previous')) 'Failure removed the existing rollback app'
      Assert (@(Get-ChildItem $rollback -Recurse -Filter 'saved').Count -eq 1) 'Failure lost the owned state backup'
    } elseif ($case -eq 'close-late-exit') {
      Assert ($receipt.status -eq 'failed' -and $receipt.closeRequested -and $calls.sleeps -ge 3) 'Late desktop exit was not awaited'
      Assert ($calls.starts -eq 1 -and $receipt.rollbackHealthy) 'Desktop that exited after the close deadline was not relaunched'
    } elseif ($case -eq 'health-transient') {
      Assert ($receipt.status -eq 'verified') 'One transient health probe rolled back a healthy update'
    } elseif ($case -eq 'runtime-no-desktop') {
      Assert ($calls.operations -notcontains 'stop-runtime') 'Runtime stopped without a desktop supervisor'
    } else {
      Assert ($calls.operations -contains 'backup') 'Runtime update skipped the WSL backup'
      Assert ([Array]::IndexOf($calls.operations, 'backup') -lt [Array]::IndexOf($calls.operations, 'stop-runtime')) 'Runtime backup ran after stop'
      Assert ($calls.operations -notcontains 'backup-windows') 'Runtime update backed up unused Windows state'
      if ($case -in @('runtime-recovery', 'runtime-recovery-late-exit')) {
        if ($case -eq 'runtime-recovery-late-exit') { Assert ($receipt.closeError -and $calls.sleeps -ge 3) 'Late desktop exit was not awaited during runtime recovery' }
        Assert ($calls.closed -eq 1 -and $calls.starts -eq 1 -and $receipt.rollbackHealthy) 'Unhealthy runtime recovery did not restart desktop'
        Assert ((Get-Content (Join-Path $client 'index.html')) -eq 'old-client') 'Runtime recovery kept the failed client'
        Assert (-not (Test-Path (Join-Path $client '.shell-version')) -and @(Get-ChildItem $resources -Filter 'client-*').Count -eq 0) 'Runtime recovery left failed or scratch client files'
      } else {
        Assert ($receipt.status -eq 'verified' -and $receipt.reloadPending -and $receipt.reloadHint -match 'Ctrl\+Shift\+R') 'Healthy runtime update did not record the pending reload'
        Assert ((Get-Content (Join-Path $client 'index.html')) -eq 'new-client') 'Runtime update kept the old client'
        Assert ((Get-Content (Join-Path $client '.shell-version')) -eq '1.2.3') 'Runtime update dropped the shell marker'
        Assert ((Get-Content (Join-Path $client 'old-chunk.js')) -eq 'old-chunk') 'Runtime update deleted a chunk the open page still needs'
        Assert ((Get-Content (Join-Path $client 'assets/old-chunk.js')) -eq 'old-nested' -and (Get-Content (Join-Path $client 'assets/shared.js')) -eq 'new-shared' -and (Get-Content (Join-Path $client 'assets/new-chunk.js')) -eq 'new-nested') 'Runtime update did not merge nested client assets'
        Assert (@(Get-ChildItem $resources -Filter 'client-*').Count -eq 0) 'Runtime update left client scratch directories'
        Assert ((Get-Content (Join-Path $install '.weavewing-local-update.json') -Raw | ConvertFrom-Json).clientCommit -eq 'client-head') 'Runtime receipt lost client provenance'
      }
    }
    Write-Host "PASS case: activation-$case"
  }
  $fixture = Join-Path $root 'check-only-runtime'
  $install = Join-Path $fixture 'installed'
  $resources = Join-Path $install 'resources'
  New-Item -ItemType Directory -Path $resources | Out-Null
  Set-Content (Join-Path $resources 'wsl-runtime.tar.gz') 'old-archive'
  Set-Content (Join-Path $resources 'wsl-runtime.tar.gz.sha256') 'old-digest'
  Set-Content (Join-Path $install 'Weavewing.exe') 'fixture-shell'
  $archive = Join-Path $fixture 'candidate.tar.gz'
  Set-Content $archive 'new-archive'
  Copy-Item (Join-Path $PSScriptRoot 'stage-windows-desktop.ps1') (Join-Path $fixture 'stage-windows-desktop.ps1')
  $configPath = Join-Path $fixture 'config.json'
  @{ install = $install; updatePath = 'wsl-only'; archive = $archive; digest = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant(); checkOnly = $true; drainMinutes = 0 } | ConvertTo-Json | Set-Content $configPath
  $invokeWsl = (Get-Item Function:Invoke-LocalUpdateWsl).ScriptBlock
  $calls = @{ operations = @() }
  function Invoke-LocalUpdateWsl {
    param($distro, $arguments, $label, $seconds, $Invoke)
    $calls.operations += $label
    if ($label -eq 'health') { return @{ healthy = $true; pid = 123; environmentId = 'fixture' } }
    if ($label -eq 'install-runtime') { return @{ installed = $true } }
    if ($label -eq 'backup') { return @{ backedUp = $true } }
    throw "Check-only attempted forbidden operation: $label"
  }
  try { Invoke-LocalDesktopUpdate $configPath 'Activate' }
  finally { Set-Item Function:Invoke-LocalUpdateWsl $invokeWsl }
  $receipt = Get-Content (Join-Path $fixture 'receipt.json') -Raw | ConvertFrom-Json
  Assert ($receipt.status -eq 'check-only-passed') 'Runtime check-only did not complete'
  Assert (($calls.operations -join ',') -eq 'health,install-runtime,backup') 'Check-only skipped backup or attempted restart'
  Write-Host 'PASS case: check-only-runtime'
  Assert ((Get-Content (Join-Path $resources 'wsl-runtime.tar.gz')) -eq 'old-archive') 'Check-only replaced the installed runtime selection'

  $fixtureHome = Join-Path $root 'home'
  $userdata = Join-Path $fixtureHome 'userdata'
  New-Item -ItemType Directory -Path $userdata | Out-Null
  $configPath = Join-Path $root 'backup-config.json'
  @{ wslHome = $fixtureHome; output = $root; backupRoot = $root; wslBackupRoot = $root; checkOnly = $true } | ConvertTo-Json | Set-Content $configPath
  $fixtureScript = Join-Path $root 'backup-fixture.mjs'
  @'
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, worker, config] = process.argv.slice(2);
const db = new DatabaseSync(path.join(root, 'statev2.sqlite'));
db.exec("PRAGMA journal_mode=WAL; CREATE TABLE saved(value TEXT); INSERT INTO saved VALUES ('preserved')");
const reader = new DatabaseSync(path.join(root, 'statev2.sqlite'), {readOnly: true});
reader.exec('BEGIN');
reader.prepare('SELECT value FROM saved').get();
db.exec("UPDATE saved SET value = 'writer committed'");
if (reader.prepare('SELECT value FROM saved').get().value !== 'preserved') throw new Error('Read snapshot changed');
db.exec("UPDATE saved SET value = 'preserved'");
reader.close();
db.close();
// A locked ownership database made the manual updater's backup retry forever.
const lock = new DatabaseSync(path.join(root, 'server-owner.sqlite'));
lock.exec('CREATE TABLE owner(id); BEGIN EXCLUSIVE');
fs.writeFileSync(path.join(root, 'settings.json'), '{"saved":true}');
fs.mkdirSync(path.join(root, 'secrets'));
fs.writeFileSync(path.join(root, 'secrets', 'fixture'), 'secret');
fs.mkdirSync(path.join(root, 'thread-workspaces'));
fs.writeFileSync(path.join(root, 'thread-workspaces', 'fixture'), 'workspace');
process.argv = [process.execPath, worker, '--worker', 'backup', config];
await import(pathToFileURL(worker).href);
const snapshot = new DatabaseSync(path.join(path.dirname(root), '..', 'backup-wsl', 'statev2.sqlite'), {readOnly: true});
if (snapshot.prepare('SELECT value FROM saved').get().value !== 'preserved') throw new Error('Snapshot lost data');
snapshot.close();
lock.close();
'@ | Set-Content $fixtureScript
  & $NodeExecutable $fixtureScript $userdata $WorkerPath $configPath
  Assert ($LASTEXITCODE -eq 0) 'State backup worker failed'
  $backup = Join-Path $root 'backup-wsl'
  Assert (Test-Path (Join-Path $backup 'statev2.sqlite')) 'State snapshot missing'
  Assert ((Get-Content (Join-Path $backup 'secrets/fixture')) -eq 'secret') 'Secrets missing'
  Assert ((Get-Content (Join-Path $backup 'thread-workspaces/fixture')) -eq 'workspace') 'Workspace missing'
  Assert (-not (Test-Path (Join-Path $backup 'server-owner.sqlite'))) 'Ownership lock entered backup'
  $failureRoot = Join-Path $root 'failure'
  New-Item -ItemType Directory -Path $failureRoot | Out-Null
  @{ wslHome = $fixtureHome; output = $root; backupRoot = $failureRoot; wslBackupRoot = $failureRoot; checkOnly = $true; backupTimeoutMs = 0 } | ConvertTo-Json | Set-Content $configPath
  try {
    $ErrorActionPreference = 'Continue'
    & $NodeExecutable $WorkerPath --worker backup $configPath 2> (Join-Path $root 'timeout.stderr')
    $failureCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = 'Stop' }
  Assert ($failureCode -ne 0) 'Expired snapshot budget succeeded'
  Assert (-not (Test-Path (Join-Path $failureRoot 'backup-wsl'))) 'Timeout left a partial snapshot'
  Assert ((Get-Content (Join-Path $root 'timeout.stderr') -Raw) -match 'timed out') 'Timeout did not explain its failure'
  foreach ($helper in Get-ChildItem (Join-Path $root 'helpers') -Filter '*.json') {
    $record = Get-Content $helper.FullName -Raw | ConvertFrom-Json
    Assert (-not (Get-Process -Id $record.pid -ErrorAction SilentlyContinue)) 'Snapshot helper remained running after completion or timeout'
  }
  Assert (Test-Path (Join-Path $userdata 'statev2.sqlite')) 'Timeout removed source state'
  'PASS: runtime selection rollback, responsiveness guard, runtime check-only, early failure receipts, bounded link checks, drain deadline, swap and rollback, refused close, read-only snapshot excluding ownership lock, timeout cleanup and captured helper exit'
} finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
