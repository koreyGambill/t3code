param([string]$ConfigPath, [ValidateSet('Preflight', 'Prepare', 'Launch', 'Activate')][string]$Mode = 'Activate')
$ErrorActionPreference = 'Stop'

function Wait-LocalUpdateDrain([double]$Minutes, [scriptblock]$Read, [scriptblock]$Now = { [DateTime]::UtcNow }, [scriptblock]$Delay = { param($seconds) Start-Sleep -Seconds $seconds }) {
  $deadline = (& $Now).AddMinutes($Minutes)
  $last = $null
  while ((& $Now) -lt $deadline) {
    $last = & $Read ($deadline - (& $Now)).TotalSeconds
    if ($last.idle) { return @{ reason = 'idle'; last = $last } }
    $remaining = ($deadline - (& $Now)).TotalSeconds
    if ($remaining -gt 0) { & $Delay ([Math]::Min(5, $remaining)) }
  }
  return @{ reason = 'deadline'; last = $last }
}

function Wait-LocalUpdateLinks([double]$Seconds, [scriptblock]$Read, [scriptblock]$Now = { [DateTime]::UtcNow }, [scriptblock]$Delay = { param($seconds) Start-Sleep -Seconds $seconds }) {
  $deadline = (& $Now).AddSeconds($Seconds)
  $last = @{ status = 'warning'; error = 'Link deadline expired before probing' }
  while ((& $Now) -lt $deadline) {
    try {
      $last = & $Read ($deadline - (& $Now)).TotalSeconds $false
      $last.status = $(if ($last.wslToWindows.status -eq 'passed' -and $last.windowsToWsl.status -eq 'passed') { 'passed' } else { 'warning' })
      if ($last.status -eq 'passed') {
        $remaining = ($deadline - (& $Now)).TotalSeconds
        if ($remaining -le 0) { return @{ status = 'warning'; error = 'Link deadline expired before authenticated checks'; descriptors = $last } }
        try {
          $last = & $Read $remaining $true
          $last.status = $(if ($last.wslToWindows.status -eq 'passed' -and $last.windowsToWsl.status -eq 'passed') { 'passed' } else { 'warning' })
        } catch { $last = @{ status = 'warning'; error = $_.Exception.Message } }
        return $last
      }
    } catch { $last = @{ status = 'warning'; error = $_.Exception.Message } }
    $remaining = ($deadline - (& $Now)).TotalSeconds
    if ($remaining -gt 0) { & $Delay ([Math]::Min(2, $remaining)) }
  }
  return $last
}

function Invoke-LocalUpdateSwap($install, $payload, $rollback, [scriptblock]$Start, [scriptblock]$Healthy, [scriptblock]$Close) {
  Move-Item -LiteralPath $install -Destination (Join-Path $rollback 'app')
  try {
    Move-Item -LiteralPath $payload -Destination $install
    & $Start
    if (-not (& $Healthy)) { throw 'New runtime did not become healthy before its deadline.' }
  } catch {
    $failure = $_
    if (Test-Path -LiteralPath $install) {
      & $Close
      Move-Item -LiteralPath $install -Destination $payload
    }
    Move-Item -LiteralPath (Join-Path $rollback 'app') -Destination $install
    throw "Activation failed; previous application restored. $failure"
  }
}

function Invoke-LocalUpdateWsl($distro, [string[]]$arguments, $label, [double]$seconds, [scriptblock]$Invoke) {
  $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
  try { & $Invoke 'wsl.exe' @('-d', $distro, '--exec', '/bin/true') 'wsl-responsive' ([Math]::Min(3, $seconds)) | Out-Null }
  catch { throw "WSL distribution '$distro' is unresponsive; refusing runtime operations. $($_.Exception.Message)" }
  $remaining = ($deadline - [DateTime]::UtcNow).TotalSeconds
  if ($remaining -le 0) { throw 'WSL responsiveness probe exhausted the operation deadline.' }
  return & $Invoke 'wsl.exe' $arguments $label $remaining
}

function Invoke-LocalRuntimeUpdate($resources, $archive, $digest, $rollback, [scriptblock]$Stop, [scriptblock]$Healthy, [scriptblock]$Recover, $clientSource) {
  $names = @('wsl-runtime.tar.gz', 'wsl-runtime.tar.gz.sha256')
  New-Item -ItemType Directory -Path $rollback -ErrorAction Stop | Out-Null
  foreach ($name in $names) { Copy-Item -LiteralPath (Join-Path $resources $name) -Destination (Join-Path $rollback $name) }
  # Client moves stay inside resources so each is a same-volume rename; the rollback directory may be elsewhere.
  $client = Join-Path $resources 'client'
  $suffix = [guid]::NewGuid().ToString()
  $clientNext = Join-Path $resources "client-$suffix.next"
  $clientPrevious = Join-Path $resources "client-$suffix.previous"
  $clientMoved = $false
  $stopping = $false
  try {
    if ($clientSource) {
      if (-not (Test-Path -LiteralPath (Join-Path $clientSource 'index.html'))) { throw 'Candidate client is missing index.html.' }
      # Keep the old hashed chunks: an open page lazy-loads them until the user reloads.
      Copy-Item -LiteralPath $client -Destination $clientNext -Recurse
      Copy-Item -Path (Join-Path $clientSource '*') -Destination $clientNext -Recurse -Force
    }
    Copy-Item -LiteralPath $archive -Destination (Join-Path $resources 'wsl-runtime.tar.gz.next')
    Set-Content -LiteralPath (Join-Path $resources 'wsl-runtime.tar.gz.sha256.next') -Value $digest -Encoding ascii
    foreach ($name in $names) { Move-Item -LiteralPath (Join-Path $resources ($name + '.next')) -Destination (Join-Path $resources $name) -Force }
    if ($clientSource) {
      Move-Item -LiteralPath $client -Destination $clientPrevious
      $clientMoved = $true
      Move-Item -LiteralPath $clientNext -Destination $client
    }
    $stopping = $true
    & $Stop
    if (-not (& $Healthy)) { throw 'New WSL runtime did not become healthy before its deadline.' }
  } catch {
    $failure = $_
    foreach ($name in $names) { Copy-Item -LiteralPath (Join-Path $rollback $name) -Destination (Join-Path $resources $name) -Force }
    if ($clientMoved) {
      if (Test-Path -LiteralPath $client) { Move-Item -LiteralPath $client -Destination (Join-Path $resources "client-$suffix.failed") }
      Move-Item -LiteralPath $clientPrevious -Destination $client
      $clientMoved = $false
      Remove-Item -LiteralPath (Join-Path $resources "client-$suffix.failed") -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($stopping) { & $Recover }
    throw "Runtime activation failed; previous archive selection restored. $failure"
  } finally {
    foreach ($name in $names) { Remove-Item -LiteralPath (Join-Path $resources ($name + '.next')) -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $clientNext -Recurse -Force -ErrorAction SilentlyContinue
    # The overlay holds every old file, so dropping the previous copy cannot break an open page.
    if ($clientMoved) { Remove-Item -LiteralPath $clientPrevious -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

function Invoke-LocalDesktopUpdate($ConfigPath, $Mode) {
  $root = Split-Path $ConfigPath
  $receipt = Join-Path $root 'receipt.json'
  $log = Join-Path $root 'activation.log'
  $helperReceipts = Join-Path $root 'helpers'
  $details = @{ status = $Mode }
  function Save-UpdateStatus($status) {
    $details.status = $status
    $details.at = [DateTime]::UtcNow.ToString('o')
    $details.helpers = @(Get-ChildItem -LiteralPath $helperReceipts -Filter '*.json' -ErrorAction SilentlyContinue | ForEach-Object { try { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json } catch {} })
    $details | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $receipt
    Add-Content -LiteralPath $log -Value ($details | ConvertTo-Json -Depth 10 -Compress)
  }
  function Record-UpdateHelper($processId, $role) {
    @{ pid = $processId; platform = 'win32'; role = $role; at = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $helperReceipts ("win32-$processId.json"))
  }
  try {
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    $install = $config.install.TrimEnd('\')
    $candidate = Join-Path (Split-Path $install) ('.' + (Split-Path $install -Leaf) + '-candidate')
    $payload = Join-Path $candidate 'payload'
    $rollback = Join-Path (Split-Path $install) ('.' + (Split-Path $install -Leaf) + '-local-update-rollback')
    $marker = Join-Path $rollback '.weavewing-update-owner'
    $worker = Join-Path $root 'worker.mjs'
    $empty = Join-Path $root 'empty-stdin'
    New-Item -ItemType Directory -Path $helperReceipts -Force | Out-Null
    $details = @{ timings = @(); updatePath = $config.updatePath; shellCommit = $config.shellCommit; clientCommit = $config.clientCommit; previousDigest = $config.previousDigest; environmentId = $config.environmentId; status = $Mode; helperReceipts = $helperReceipts; commit = $config.commit; digest = $config.digest; install = $install; rollback = $rollback; checkOnly = $config.checkOnly; drainSource = $(if ($config.authorizationFile) { 'mcp' } else { 'read-only-sqlite' }) }
    Record-UpdateHelper $PID "powershell:$Mode"
    function Quote-UpdateArgument([string]$value) {
      if ($value.Contains('"') -or $value.Contains("`r") -or $value.Contains("`n")) { throw 'Arguments must not contain quotes or newlines.' }
      if ($value -notmatch '\s') { return $value }
      return '"' + $value + '"'
    }
    function Invoke-UpdateProcess($executable, [string[]]$arguments, $label, [double]$seconds = 60) {
      $started = [DateTime]::UtcNow
      $stdout = Join-Path $root ($label + '.stdout')
      $stderr = Join-Path $root ($label + '.stderr')
      # Detached wsl.exe waits forever on inherited stdin after its parent exits.
      $process = Start-Process -FilePath $executable -ArgumentList ($arguments | ForEach-Object { Quote-UpdateArgument $_ }) -RedirectStandardInput $empty -RedirectStandardOutput $stdout -RedirectStandardError $stderr -NoNewWindow -PassThru
      $null = $process.Handle
      Record-UpdateHelper $process.Id $label
      if (-not $process.WaitForExit([Math]::Max(1, $seconds * 1000))) { $process.Kill(); throw "$label exceeded ${seconds}s; captured helper stopped. Inspect $stdout and $stderr." }
      if ($process.ExitCode -ne 0) { throw "$label failed ($($process.ExitCode)). $(Get-Content -LiteralPath $stderr -Raw)" }
      $details.timings += @{ operation = $label; milliseconds = ([DateTime]::UtcNow - $started).TotalMilliseconds }
      Add-Content -LiteralPath $log -Value (@{ operation = $label; milliseconds = ([DateTime]::UtcNow - $started).TotalMilliseconds; at = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress)
      return (Get-Content -LiteralPath $stdout -Raw | ConvertFrom-Json)
    }
    function Probe-Update($operation, [string[]]$extra = @(), [double]$seconds = 30) {
      return Invoke-LocalUpdateWsl $config.distro (@('-d', $config.distro, '--exec', $config.node, ($config.output + '/worker.mjs'), '--worker', $operation, ($config.output + '/config.json')) + $extra) $operation $seconds {
        param($executable, $arguments, $label, $remaining)
        Invoke-UpdateProcess $executable $arguments $label $remaining
      }
    }

    function Windows-UpdateWorker($operation, [string[]]$extra = @(), [double]$seconds = 30) {
      $previous = $env:ELECTRON_RUN_AS_NODE
      $env:ELECTRON_RUN_AS_NODE = '1'
      try { return Invoke-UpdateProcess (Join-Path $install 'Weavewing.exe') (@($worker, '--worker', $operation, $ConfigPath) + $extra) $operation $seconds }
      finally { $env:ELECTRON_RUN_AS_NODE = $previous }
    }
    function Get-UpdateProcesses {
      Get-Process | Where-Object { $_.Path -and $_.Path.Equals((Join-Path $install 'Weavewing.exe'), [StringComparison]::OrdinalIgnoreCase) }
    }
    function Close-UpdateDesktop {
      $all = @(Get-UpdateProcesses)
      if ($all.Count -eq 0) { return }
      $main = @($all | Where-Object { $_.MainWindowHandle -ne 0 })
      if ($main.Count -ne 1) { throw "Expected one main window at $install, found $($main.Count). Close it manually; no process was force-killed." }
      if (-not $main[0].CloseMainWindow()) { throw 'Desktop refused graceful close.' }
      $details.closeRequested = $true
      $closeSeconds = $(if ($null -ne $config.closeSeconds) { [double]$config.closeSeconds } else { 90 })
      if (-not (Wait-UpdateDesktopExit $closeSeconds)) { throw "Desktop did not close in ${closeSeconds}s; no process was force-killed." }
    }
    function Wait-UpdateDesktopExit([double]$seconds) {
      $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
      while (@(Get-UpdateProcesses).Count -gt 0) {
        if ([DateTime]::UtcNow -ge $deadline) { return $false }
        Start-Sleep -Seconds 1
      }
      return $true
    }
    function Start-UpdateDesktop {
      $launcher = Start-Process -FilePath (Join-Path $install 'Start Weavewing.cmd') -WorkingDirectory $install -WindowStyle Hidden -PassThru
      Record-UpdateHelper $launcher.Id 'desktop-launcher'
    }
    function Wait-UpdateHealthy($digest) {
      $deadline = [DateTime]::UtcNow.AddSeconds($config.healthSeconds)
      do {
        $remaining = ($deadline - [DateTime]::UtcNow).TotalSeconds
        if ($remaining -le 0) { break }
        try {
          $health = Probe-Update 'health' @($digest) ([Math]::Min(5, $remaining))
          $details.lastHealth = $health
          if ($health.healthy) { $details.health = $health; return $true }
        } catch { $details.lastHealth = @{ healthy = $false; error = $_.Exception.Message } }
        $remaining = ($deadline - [DateTime]::UtcNow).TotalSeconds
        if ($remaining -gt 0) { Start-Sleep -Milliseconds ([Math]::Min(500, $remaining * 1000)) }
      } while ([DateTime]::UtcNow -lt $deadline)
      return $false
    }
    function Wait-UpdateStopped($processId) {
      $deadline = [DateTime]::UtcNow.AddSeconds(30)
      do {
        $remaining = ($deadline - [DateTime]::UtcNow).TotalSeconds
        if ($remaining -le 0) { throw 'WSL server did not exit within 30s; refusing to move its application.' }
        if ((Probe-Update 'stopped' @([string]$processId) ([Math]::Min(5, $remaining))).stopped) { return }
        Start-Sleep -Milliseconds 500
      } while ([DateTime]::UtcNow -lt $deadline)
      throw 'WSL server did not exit within 30s; refusing to move its application.'
    }
    function Assert-UpdateRollback {
      if (Test-Path -LiteralPath $rollback) {
        if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -ne $install) { throw "Unowned rollback directory: $rollback" }
        if (@(@(Get-Item -LiteralPath $rollback) + @(Get-ChildItem -LiteralPath $rollback -Recurse -Force) | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Rollback contains links; inspect it manually.' }
        if (Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($rollback + '\', [StringComparison]::OrdinalIgnoreCase) }) { throw 'Rollback has a running executable.' }
      }
    }
    function Assert-UpdatePayload {
      if (-not (Test-Path -LiteralPath (Join-Path $candidate '.weavewing-stage-owner')) -or (Get-Content -LiteralPath (Join-Path $candidate '.weavewing-stage-owner') -Raw).Trim() -ne $install) { throw 'Candidate is unowned.' }
      if ((Get-FileHash -LiteralPath (Join-Path $payload 'Weavewing.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.exeHash) { throw 'Staged executable changed.' }
      if ((Get-FileHash -LiteralPath (Join-Path $payload 'resources/wsl-runtime.tar.gz') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.digest) { throw 'Staged runtime digest changed.' }
      if (-not (Test-Path -LiteralPath (Join-Path $payload 'Start Weavewing.cmd'))) { throw 'Staged launcher missing.' }
    }
    # The detached Activate run receives this file as its own stdin, so it cannot be rewritten then.
    if (-not (Test-Path -LiteralPath $empty)) { Set-Content -LiteralPath $empty -Value '' -NoNewline }
    . (Join-Path $root 'stage-windows-desktop.ps1')
    if ($Mode -eq 'Preflight') {
      if ($config.updatePath -ne 'wsl-only') { Stage-WindowsDesktop $install $install -CheckOnly }
      if ($config.updatePath -eq 'wsl-only' -and $config.shellHash -and (Get-FileHash -LiteralPath (Join-Path $install 'resources/app.asar') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.shellHash) { throw 'Installed shell no longer matches its receipt; use --full.' }
      if ($config.updatePath -eq 'wsl-only' -and $config.exeHash -and (Get-FileHash -LiteralPath (Join-Path $install 'Weavewing.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.exeHash) { throw 'Installed shell no longer matches its receipt; use --full.' }
      if (-not (Test-Path -LiteralPath (Join-Path $install 'Start Weavewing.cmd'))) { throw 'Install must have Start Weavewing.cmd.' }
      Assert-UpdateRollback
      if ($config.updatePath -ne 'wsl-only' -and -not $config.checkOnly -and (Test-Path -LiteralPath $config.backupRootWindows)) { throw "Interrupted state backup: inspect $($config.backupRootWindows) before updating." }
      $oldDigest = (Get-FileHash -LiteralPath (Join-Path $install 'resources/wsl-runtime.tar.gz') -Algorithm SHA256).Hash.ToLowerInvariant()
      if (-not (Probe-Update 'health' @($oldDigest)).healthy) { throw 'Installed WSL runtime is not healthy; repair it before updating.' }
      Save-UpdateStatus 'preflight-passed'
      return
    }
    if ($Mode -eq 'Prepare') {
      Stage-WindowsDesktop $config.source $install | Out-Null
      foreach ($name in @('Start Weavewing.cmd', 'Start Scratchboard.cmd', 'Create Weavewing shortcut.ps1', 'Weavewing.ico')) {
        $file = Join-Path $install $name
        if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination (Join-Path $payload $name) -Force }
      }
      Assert-UpdatePayload
      # LMDB cannot open its databases through a WSL UNC path.
      $native = Join-Path ([IO.Path]::GetTempPath()) ('weavewing-native-' + [guid]::NewGuid().ToString())
      New-Item -ItemType Directory -Path $native | Out-Null
      $env:ELECTRON_RUN_AS_NODE = '1'
      $env:NODE_PATH = ''
      Remove-Item Env:NODE_OPTIONS, Env:ELECTRON_NO_ASAR -ErrorAction SilentlyContinue
      try { $details.native = Invoke-UpdateProcess (Join-Path $payload 'Weavewing.exe') @('--no-global-search-paths', $worker, '--worker', 'native', $ConfigPath, $payload, $native) 'native' } finally {
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $native -Recurse -Force -ErrorAction SilentlyContinue
      }
      $details.runtimeInstall = Probe-Update 'install-runtime'
      Save-UpdateStatus 'staged-and-verified'
      return
    }
    if ($Mode -eq 'Launch') {
      if ($config.updatePath -ne 'wsl-only') { Assert-UpdatePayload }
      Save-UpdateStatus 'detached'
      $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Quote-UpdateArgument $PSCommandPath), '-ConfigPath', (Quote-UpdateArgument $ConfigPath), '-Mode', 'Activate') -RedirectStandardInput $empty -RedirectStandardOutput (Join-Path $root 'detached.stdout') -RedirectStandardError (Join-Path $root 'detached.stderr') -WindowStyle Hidden -PassThru
      Record-UpdateHelper $process.Id 'detached-activation'
      @{ pid = $process.Id; receipt = $receipt } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'detached.json')
      return
    }
    $mutex = [Threading.Mutex]::new($false, 'Local\WeavewingLocalDesktopUpdate')
    if (-not $mutex.WaitOne(0)) { $mutex.Dispose(); throw 'Another local update is active.' }
    $closed = $false
    $swapStarted = $false
    $stateCreated = $false
    $windowsScratch = $null
    $oldDigest = ''
    try {
      if ($config.updatePath -eq 'wsl-only') {
        $resources = Join-Path $install 'resources'
        $oldDigest = (Get-FileHash -LiteralPath (Join-Path $resources 'wsl-runtime.tar.gz') -Algorithm SHA256).Hash.ToLowerInvariant()
        $details.previousDigest = $oldDigest
        $old = Probe-Update 'health' @($oldDigest)
        if (-not $old.healthy) { throw 'Installed runtime is unhealthy; refusing restart.' }
        if ((Get-FileHash -LiteralPath $config.archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.digest) { throw 'Candidate archive changed.' }
        $details.runtimeInstall = Probe-Update 'install-runtime'
        $details.drain = Wait-LocalUpdateDrain $config.drainMinutes {
          param($remaining)
          try { Probe-Update 'idle' @() ([Math]::Min(5, $remaining)) } catch { @{ idle = $false; error = $_.Exception.Message } }
        }
        Save-UpdateStatus 'backing-up'
        $details.wslBackup = Probe-Update 'backup' @() 300
        if ($config.checkOnly) { Save-UpdateStatus 'check-only-passed'; return }
        if (@(Get-UpdateProcesses | Where-Object { $_.MainWindowHandle -ne 0 }).Count -ne 1) { throw 'Runtime-only updates require a running desktop supervisor; start the desktop first.' }
        $runtimeRollback = Join-Path $root 'runtime-rollback'
        Save-UpdateStatus 'activating-runtime'
        Invoke-LocalRuntimeUpdate $resources $config.archive $config.digest $runtimeRollback {
          if (@(Get-UpdateProcesses | Where-Object { $_.MainWindowHandle -ne 0 }).Count -ne 1) { throw 'Desktop exited before runtime restart.' }
          Probe-Update 'stop-runtime' @($oldDigest) | Out-Null
        } { Wait-UpdateHealthy $config.digest } {
          # The supervisor may already have restarted either selection.
          try { Probe-Update 'stop-runtime' @($config.digest) | Out-Null } catch { Add-Content -LiteralPath $log -Value $_ }
          $details.rollbackHealthy = Wait-UpdateHealthy $oldDigest
          if (-not $details.rollbackHealthy) {
            Close-UpdateDesktop
            Start-UpdateDesktop
            $details.rollbackHealthy = Wait-UpdateHealthy $oldDigest
            if (-not $details.rollbackHealthy) { throw 'Previous runtime remains unhealthy after relaunching desktop.' }
          }
        } $config.clientSource
        if ($config.clientSource) { $details.reloadPending = $true; $details.reloadHint = 'UI updated - press Ctrl+Shift+R in Weavewing to load it.' }
        @{ shellCommit = $config.shellCommit; clientCommit = $config.clientCommit; clientAssetsDirectory = $config.clientAssetsDirectory; commit = $config.commit; digest = $config.digest; previousDigest = $oldDigest; exeHash = $config.exeHash; shellHash = $config.shellHash } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $install '.weavewing-local-update.json')
        Save-UpdateStatus 'verified'
        return
      }
      Assert-UpdatePayload
      Assert-UpdateRollback
      if ($config.checkOnly) {
        $windowsScratch = Join-Path ([IO.Path]::GetTempPath()) ('weavewing-backups-' + [guid]::NewGuid().ToString())
        New-Item -ItemType Directory -Path $windowsScratch | Out-Null
        $config | Add-Member -NotePropertyName windowsBackupRoot -NotePropertyValue $windowsScratch -Force
      } else {
        if (Test-Path -LiteralPath $config.backupRootWindows) { throw "Interrupted state backup: inspect $($config.backupRootWindows) before updating." }
        New-Item -ItemType Directory -Path $config.backupRootWindows | Out-Null
        $stateCreated = $true
        Set-Content -LiteralPath (Join-Path $config.backupRootWindows '.weavewing-update-owner') -Value $install
        $config | Add-Member -NotePropertyName windowsBackupRoot -NotePropertyValue $config.backupRootWindows -Force
      }
      $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ConfigPath
      try {
        $config | Add-Member -NotePropertyName linkBaseline -NotePropertyValue @{
          wsl = (Probe-Update 'capture-links')
          windows = (Windows-UpdateWorker 'capture-links-windows')
        } -Force
        $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ConfigPath
      } catch { $details.links = @{ status = 'warning'; error = "Could not capture existing peer links: $($_.Exception.Message)" } }
      $oldDigest = (Get-FileHash -LiteralPath (Join-Path $install 'resources/wsl-runtime.tar.gz') -Algorithm SHA256).Hash.ToLowerInvariant()
      $old = Probe-Update 'health' @($oldDigest)
      if (-not $old.healthy) { throw 'Installed runtime became unhealthy before drain.' }
      Save-UpdateStatus 'draining'
      $details.drain = Wait-LocalUpdateDrain $config.drainMinutes {
        param($remaining)
        try { Probe-Update 'idle' @() ([Math]::Min(30, $remaining)) } catch { @{ idle = $false; error = $_.Exception.Message } }
      }
      Save-UpdateStatus 'backing-up'
      $details.wslBackup = Probe-Update 'backup' @() 300
      $env:ELECTRON_RUN_AS_NODE = '1'
      try { $details.windowsBackup = Invoke-UpdateProcess (Join-Path $install 'Weavewing.exe') @($worker, '--worker', 'backup-windows', $ConfigPath) 'backup-windows' 300 } finally { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
      if ($config.checkOnly) { Save-UpdateStatus 'check-only-passed'; return }
      Assert-UpdatePayload
      $closed = $true
      Save-UpdateStatus 'closing-desktop'
      Close-UpdateDesktop
      Save-UpdateStatus 'waiting-previous-runtime'
      Wait-UpdateStopped $old.pid
      if (Test-Path -LiteralPath $rollback) { Remove-Item -LiteralPath $rollback -Recurse -Force }
      New-Item -ItemType Directory -Path $rollback | Out-Null
      Set-Content -LiteralPath $marker -Value $install
      Move-Item -LiteralPath (Join-Path $config.backupRootWindows 'backup-windows') -Destination (Join-Path $rollback 'backup-windows')
      Remove-Item -LiteralPath $config.backupRootWindows -Recurse -Force
      $details.windowsBackup.path = Join-Path $rollback 'backup-windows'
      Save-UpdateStatus 'activating'
      $swapStarted = $true
      Invoke-LocalUpdateSwap $install $payload $rollback { Start-UpdateDesktop; Save-UpdateStatus 'waiting-new-runtime' } { Wait-UpdateHealthy $config.digest } {
        $current = try { Probe-Update 'health' @($config.digest) } catch { @{ } }
        Close-UpdateDesktop
        if ($current.pid) {
          Wait-UpdateStopped $current.pid
        }
      }
      # Link availability can lag app startup; it must not roll back a healthy app.
      if ($config.linkBaseline) {
        $details.links = Wait-LocalUpdateLinks ([Math]::Min(20, $config.healthSeconds)) {
          param($remaining, $authenticate)
          $budget = $(if ($authenticate) { $remaining / 2 } else { [Math]::Min(10, $remaining / 2) })
          $arguments = @($budget.ToString([Globalization.CultureInfo]::InvariantCulture), $(if ($authenticate) { 'authenticate' } else { 'descriptor-only' }))
          $wsl = try { Probe-Update 'check-links' $arguments $budget } catch { @{ status = 'warning'; error = $_.Exception.Message } }
          $windows = try { Windows-UpdateWorker 'check-links-windows' $arguments $budget } catch { @{ status = 'warning'; error = $_.Exception.Message } }
          @{ wslToWindows = $wsl; windowsToWsl = $windows }
        }
      }
      if ($details.links.status -ne 'passed') { $details.warning = 'Warning: linked-environment check did not pass. Inspect links in the receipt. The healthy app was kept running.' }
      @{ shellCommit = $config.shellCommit; clientCommit = $config.clientCommit; clientAssetsDirectory = $config.clientAssetsDirectory; commit = $config.commit; digest = $config.digest; previousDigest = $oldDigest; exeHash = $config.exeHash; shellHash = $config.shellHash } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $install '.weavewing-local-update.json')
      Save-UpdateStatus 'verified'
    } catch {
      $details.error = $_.Exception.Message
      if ($closed -and (-not $swapStarted -or -not (Test-Path -LiteralPath (Join-Path $rollback 'app')))) {
        try {
          # A close that timed out may still finish; deciding on the first look would leave no desktop.
          if ($details.closeRequested) { Wait-UpdateDesktopExit 90 | Out-Null }
          if (@(Get-UpdateProcesses).Count -eq 0) { Start-UpdateDesktop }
          $details.rollbackHealthy = Wait-UpdateHealthy $oldDigest
        } catch { $details.recoveryError = $_.Exception.Message }
      }
      Save-UpdateStatus 'failed'
      throw
    } finally {
      if ($windowsScratch) { Remove-Item -LiteralPath $windowsScratch -Recurse -Force -ErrorAction SilentlyContinue }
      if ($stateCreated -and (Test-Path -LiteralPath $config.backupRootWindows)) {
        try {
          if ($closed) {
            Assert-UpdateRollback
            New-Item -ItemType Directory -Path $rollback -Force | Out-Null
            Set-Content -LiteralPath $marker -Value $install
            $retained = Join-Path $rollback ('interrupted-state-' + [guid]::NewGuid().ToString())
            Move-Item -LiteralPath $config.backupRootWindows -Destination $retained
            $details.retainedState = $retained
            Save-UpdateStatus $details.status
          } else { Remove-Item -LiteralPath $config.backupRootWindows -Recurse -Force }
        } catch { $details.backupRecoveryError = $_.Exception.Message; Save-UpdateStatus $details.status }
      }
      if ($config.notifyThread -and -not $config.checkOnly) {
        try { Probe-Update 'notify' @($(if ($details.status -eq 'verified') { $config.digest } else { $oldDigest }), "Automated local update result: $($details.status). Commit $($config.commit). Receipt: $($config.output)/receipt.json. $($details.warning) $($details.reloadHint)") | Out-Null } catch { Add-Content -LiteralPath $log -Value "Notification failed: $_" }
      }
      $mutex.ReleaseMutex()
      $mutex.Dispose()
    }
  } catch {
    $details.error = $_.Exception.Message
    Save-UpdateStatus 'failed'
    throw
  }
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-LocalDesktopUpdate $ConfigPath $Mode }
