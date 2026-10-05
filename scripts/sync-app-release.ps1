param(
    [string]$AppReleaseDirectory,
    [switch]$CheckOnly,
    [switch]$Push
)
$ErrorActionPreference = 'Stop'
$mainWorkingRoot = Split-Path -Parent $PSScriptRoot
$appWorkingRoot = Join-Path $mainWorkingRoot '.app-workspace'
if (!$AppReleaseDirectory) { $AppReleaseDirectory = Join-Path (Split-Path -Parent $mainWorkingRoot) 'CustodySim-app' }
function Invoke-AppGit([string]$Directory, [string[]]$Arguments) {
    $result = & git -C $Directory @Arguments
    if ($LASTEXITCODE) { throw "Git failed: $($Arguments[0])" }
    return $result
}
foreach ($checkout in @($appWorkingRoot, $AppReleaseDirectory)) {
    if (!(Test-Path -LiteralPath (Join-Path $checkout '.git'))) { throw "Missing App checkout: $checkout" }
    if (Invoke-AppGit $checkout @('status', '--porcelain')) { throw "Commit or preserve App checkout changes before sync: $checkout" }
    $remote = Invoke-AppGit $checkout @('remote', 'get-url', 'origin')
    if ($remote -ne 'https://github.com/PDSB001/CustodySim-app.git') { throw 'Unexpected App remote; refusing to sync' }
}
if ((Invoke-AppGit $AppReleaseDirectory @('branch', '--show-current')) -ne 'main') { throw 'Release checkout must use main' }
$worktreeCommit = Invoke-AppGit $appWorkingRoot @('rev-parse', 'HEAD')
# Both local directories belong to the same independent App Git repository.
$workingGit = Invoke-AppGit $appWorkingRoot @('rev-parse', '--path-format=absolute', '--git-common-dir')
$releaseGit = Invoke-AppGit $AppReleaseDirectory @('rev-parse', '--path-format=absolute', '--git-common-dir')
if ($workingGit -ne $releaseGit) { throw 'App worktree and release checkout must share Git history; no file overwrite fallback is allowed' }
Invoke-AppGit $AppReleaseDirectory @('merge-base', '--is-ancestor', 'HEAD', $worktreeCommit) | Out-Null
if ($CheckOnly) { Write-Output "Ready to sync App commit $worktreeCommit"; return }
Invoke-AppGit $AppReleaseDirectory @('merge', '--ff-only', $worktreeCommit) | Out-Host
$wrapper = Join-Path $AppReleaseDirectory 'gradlew.bat'
& $wrapper -p $AppReleaseDirectory :app:assembleRelease :app:assembleProduction :app:testDebugUnitTest androidCorrespondingSource --console=plain
if ($LASTEXITCODE) { throw 'Release build failed; nothing was pushed' }
if ($Push) { Invoke-AppGit $AppReleaseDirectory @('push', 'origin', 'main') | Out-Host }
Write-Output "App synchronized and built at $AppReleaseDirectory. Release signing remains your configured signing workflow."
