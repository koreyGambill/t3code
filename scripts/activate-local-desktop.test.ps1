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
  }
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
  'PASS: early failure receipts, bounded link checks, drain deadline, swap and rollback, refused close, read-only snapshot excluding ownership lock, timeout cleanup and captured helper exit'
} finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
