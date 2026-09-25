param(
  [switch]$NoHooks,
  [switch]$Update,
  [switch]$Uninstall,
  [switch]$Yes,
  [Alias("Host")][ValidateSet("claude", "shared", "all")][string]$TargetHost = "all"
)

$ErrorActionPreference = "Stop"

$CharthouseSourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CharthouseClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }
$CharthouseRuntimeDir = if ($env:CHARTHOUSE_HOME) { $env:CHARTHOUSE_HOME } else { Join-Path $HOME ".charthouse" }
$CharthouseLegacyRuntimeDir = Join-Path $CharthouseClaudeDir "charthouse"
$CharthouseClaudeSkillsDir = Join-Path $CharthouseClaudeDir "skills"
$CharthouseSharedSkillsDir = if ($env:AGENT_SKILLS_DIR) { $env:AGENT_SKILLS_DIR } else { Join-Path $HOME ".agents\skills" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Charthouse requires Node.js 22 or newer; node was not found."
}
$NodeVersion = (& node -p "process.versions.node").Trim()
$NodeMajor = [int]($NodeVersion.Split('.')[0])
if ($NodeMajor -lt 22) {
  throw "Charthouse requires Node.js 22 or newer; found v$NodeVersion."
}

if ($Uninstall) {
  if ($Update -or $NoHooks -or $PSBoundParameters.ContainsKey("TargetHost")) {
    throw "-Uninstall removes every adapter. Do not combine it with -Update, -TargetHost or -NoHooks."
  }
  $UninstallArguments = @()
  if ($Yes) { $UninstallArguments += "--yes" }
  & node (Join-Path $CharthouseSourceDir "scripts\uninstall.mjs") @UninstallArguments
  exit $LASTEXITCODE
}

$CharthouseRuntimeDir = [IO.Path]::GetFullPath($CharthouseRuntimeDir)
$CharthouseClaudeDir = [IO.Path]::GetFullPath($CharthouseClaudeDir)
$CharthouseSharedSkillsDir = [IO.Path]::GetFullPath($CharthouseSharedSkillsDir)
$CharthouseLegacyRuntimeDir = Join-Path $CharthouseClaudeDir "charthouse"
$CharthouseClaudeSkillsDir = Join-Path $CharthouseClaudeDir "skills"
function Test-SameOrAncestor($Parent, $Child) {
  $Separators = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $ParentPath = [IO.Path]::GetFullPath($Parent).TrimEnd($Separators)
  $ChildPath = [IO.Path]::GetFullPath($Child).TrimEnd($Separators)
  return $ChildPath.Equals($ParentPath, [StringComparison]::OrdinalIgnoreCase) -or $ChildPath.StartsWith("$ParentPath$([IO.Path]::DirectorySeparatorChar)", [StringComparison]::OrdinalIgnoreCase)
}
$RuntimeRoot = [IO.Path]::GetPathRoot($CharthouseRuntimeDir)
if ($CharthouseRuntimeDir -eq $RuntimeRoot -or (Test-SameOrAncestor $CharthouseRuntimeDir $HOME) `
    -or (Test-SameOrAncestor $CharthouseRuntimeDir $CharthouseSourceDir) -or (Test-SameOrAncestor $CharthouseSourceDir $CharthouseRuntimeDir) `
    -or (Test-SameOrAncestor $CharthouseRuntimeDir $CharthouseClaudeDir) -or (Test-SameOrAncestor $CharthouseRuntimeDir $CharthouseSharedSkillsDir)) {
  throw "Unsafe CHARTHOUSE_HOME: $CharthouseRuntimeDir"
}
foreach ($Directory in @($CharthouseClaudeSkillsDir, $CharthouseSharedSkillsDir)) {
  if ($Directory -eq [IO.Path]::GetPathRoot($Directory) -or (Test-SameOrAncestor $Directory $CharthouseSourceDir) -or (Test-SameOrAncestor $CharthouseSourceDir $Directory)) {
    throw "Unsafe skill directory: $Directory"
  }
}

# The runtime swap below deletes whatever is at the runtime path. Replace only
# an installed runtime or an empty folder; any other folder can hold user files.
function Get-CharthouseRuntimeState($Dir) {
  try {
    $State = & node (Join-Path $CharthouseSourceDir "scripts\runtime-state.mjs") $Dir 2>$null
    if ($LASTEXITCODE -eq 0) { return "$State".Trim() }
  } catch {}
  return "other"
}
$RuntimeState = Get-CharthouseRuntimeState $CharthouseRuntimeDir
$LegacyState = Get-CharthouseRuntimeState $CharthouseLegacyRuntimeDir
if ($RuntimeState -notin @("missing", "empty", "runtime")) {
  throw "$CharthouseRuntimeDir exists and is not a Charthouse runtime. Nothing changed. Set CHARTHOUSE_HOME to another folder or remove this one."
}

function Get-CharthouseVersion($Dir) {
  try { return (Get-Content (Join-Path $Dir "package.json") -Raw | ConvertFrom-Json).version } catch { return "unknown" }
}
function Get-CharthouseCommit($Dir) {
  try { $c = & git -C $Dir rev-parse --short HEAD 2>$null; if ($LASTEXITCODE -eq 0) { return $c } } catch {}
  return "no commit"
}
function Get-CharthouseDirty($Dir) {
  try {
    $Status = & git -C $Dir status --porcelain --untracked-files=normal 2>$null
    return $LASTEXITCODE -eq 0 -and [bool]$Status
  } catch { return $false }
}
function Format-CharthouseRevision($Commit, $Dirty) {
  if ($Dirty) { return "${Commit}-dirty" }
  return $Commit
}

$SourceVersion = Get-CharthouseVersion $CharthouseSourceDir
$SourceCommit = Get-CharthouseCommit $CharthouseSourceDir
$SourceDirty = Get-CharthouseDirty $CharthouseSourceDir
$SourceRevision = Format-CharthouseRevision $SourceCommit $SourceDirty
$CurrentRuntime = if ($RuntimeState -eq "runtime") { $CharthouseRuntimeDir } elseif ($LegacyState -eq "runtime") { $CharthouseLegacyRuntimeDir } else { $CharthouseRuntimeDir }
$Installed = ($RuntimeState -eq "runtime") -or ($LegacyState -eq "runtime") `
  -or (Test-Path (Join-Path $CharthouseClaudeSkillsDir "charthouse")) -or (Test-Path (Join-Path $CharthouseClaudeSkillsDir "charthouse-context")) `
  -or (Test-Path (Join-Path $CharthouseSharedSkillsDir "charthouse")) -or (Test-Path (Join-Path $CharthouseSharedSkillsDir "charthouse-context"))

if ($Installed) {
  $InstalledVersion = Get-CharthouseVersion $CurrentRuntime
  $InstalledCommit = "unknown commit"
  $InstalledDirty = $false
  try {
    $InstalledStamp = Get-Content (Join-Path $CurrentRuntime ".install.json") -Raw | ConvertFrom-Json
    $InstalledCommit = $InstalledStamp.commit
    $InstalledDirty = $InstalledStamp.dirty -eq $true
  } catch {}
  $InstalledRevision = Format-CharthouseRevision $InstalledCommit $InstalledDirty
  Write-Host "Charthouse $InstalledVersion ($InstalledRevision) is installed in $CurrentRuntime."
  Write-Host "This checkout is $SourceVersion ($SourceRevision)."
  if (-not $Update) {
    if ($Yes) {
      $Update = $true
    } elseif ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
      $Answer = Read-Host "Update the installation from this checkout? [Y/n]"
      if ($Answer -eq "" -or $Answer -match '^(y|yes)$') { $Update = $true } else { Write-Host "Nothing changed."; exit 0 }
    } else {
      throw "Run install.ps1 -Update to replace it from this checkout, or use plugin mode."
    }
  }
} elseif ($Update) {
  throw "Charthouse is not installed. Run install.ps1 without -Update."
}

$StageDir = "$CharthouseRuntimeDir.install-$PID"
if (Test-Path $StageDir) { Remove-Item -Recurse -Force -Path $StageDir }
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
foreach ($Name in @(".claude-plugin", "agents", "bin", "docs", "hooks", "schemas", "scripts", "skills", "templates")) {
  Copy-Item -Recurse -Path (Join-Path $CharthouseSourceDir $Name) -Destination (Join-Path $StageDir $Name)
}
Copy-Item -Path (Join-Path $CharthouseSourceDir "package.json") -Destination $StageDir
Copy-Item -Path (Join-Path $CharthouseSourceDir "LICENSE") -Destination $StageDir
$Hosts = if ($TargetHost -eq "all") { @("claude", "shared") } else { @($TargetHost) }
$InstallHooks = -not $NoHooks -and ($TargetHost -eq "claude" -or $TargetHost -eq "all")
@{ version = $SourceVersion; commit = $SourceCommit; dirty = $SourceDirty; source = $CharthouseSourceDir; runtime = $CharthouseRuntimeDir; hosts = $Hosts; hooks = $InstallHooks; installed_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") } |
  ConvertTo-Json | Set-Content (Join-Path $StageDir ".install.json")

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CharthouseRuntimeDir) | Out-Null
$BackupDir = "$CharthouseRuntimeDir.previous-$PID"
if (Test-Path $BackupDir) { Remove-Item -Recurse -Force -Path $BackupDir }
if (Test-Path $CharthouseRuntimeDir) { Move-Item -Path $CharthouseRuntimeDir -Destination $BackupDir }
try {
  Move-Item -Path $StageDir -Destination $CharthouseRuntimeDir
  if (Test-Path $BackupDir) { Remove-Item -Recurse -Force -Path $BackupDir }
} catch {
  if (Test-Path $CharthouseRuntimeDir) { Remove-Item -Recurse -Force -Path $CharthouseRuntimeDir }
  if (Test-Path $BackupDir) { Move-Item -Path $BackupDir -Destination $CharthouseRuntimeDir }
  throw "Charthouse could not replace the runtime; the previous installation was restored. $($_.Exception.Message)"
}
if ($TargetHost -ne "shared" -and $CharthouseLegacyRuntimeDir -ne $CharthouseRuntimeDir) {
  if ($LegacyState -eq "runtime") { Remove-Item -Recurse -Force -Path $CharthouseLegacyRuntimeDir }
  elseif ($LegacyState -eq "other") { Write-Host "Kept ${CharthouseLegacyRuntimeDir}: it is not a Charthouse runtime." }
}

function Install-CharthouseSkillPair($Destination) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  foreach ($Name in @("charthouse", "charthouse-context")) {
    $Target = Join-Path $Destination $Name
    if (Test-Path $Target) { Remove-Item -Recurse -Force -Path $Target }
    Copy-Item -Recurse -Path (Join-Path $CharthouseSourceDir "skills\$Name") -Destination $Target
  }
}

if ($TargetHost -eq "claude" -or $TargetHost -eq "all") { Install-CharthouseSkillPair $CharthouseClaudeSkillsDir }
if ($TargetHost -eq "shared" -or $TargetHost -eq "all") { Install-CharthouseSkillPair $CharthouseSharedSkillsDir }

if (-not $NoHooks -and ($TargetHost -eq "claude" -or $TargetHost -eq "all")) {
  & node (Join-Path $CharthouseRuntimeDir "scripts\install-standalone-hooks.mjs") $CharthouseClaudeDir $CharthouseRuntimeDir
  if ($LASTEXITCODE -ne 0) { throw "Charthouse hook installation failed." }
}

if ($Update) {
  Write-Host "Updated Charthouse to $SourceVersion ($SourceRevision) for $TargetHost. Restart open coding-agent sessions."
} else {
  Write-Host "Installed Charthouse $SourceVersion ($SourceRevision) for $TargetHost. Restart open coding-agent sessions."
}
if ($NoHooks -and ($TargetHost -eq "claude" -or $TargetHost -eq "all")) { Write-Host "Claude hooks were not installed. Charthouse remains available on demand." }
