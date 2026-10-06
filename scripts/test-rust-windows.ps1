# Tauri's test executables need Common Controls v6 before the Windows loader runs.
# https://github.com/tauri-apps/tauri/issues/13419
$ErrorActionPreference = 'Stop'
# Native exit codes are checked explicitly, including the expected missing-resource probe.
$PSNativeCommandUseErrorActionPreference = $false

$manifestTool = Get-Command mt.exe -ErrorAction SilentlyContinue
if ($manifestTool) {
    $mt = $manifestTool.Source
} else {
    $sdkTool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\mt.exe" |
        Sort-Object { [version]$_.Directory.Parent.Name } -Descending |
        Select-Object -First 1
    if (-not $sdkTool) {
        throw 'Windows SDK mt.exe is required to run the Tauri tests.'
    }
    $mt = $sdkTool.FullName
}

$cargoManifest = Join-Path $PSScriptRoot '../src-tauri/Cargo.toml'
$testManifest = Join-Path $PSScriptRoot 'windows-test.manifest'
$buildOutput = & cargo +stable test --manifest-path $cargoManifest --locked --all-targets --no-run --message-format=json
if ($LASTEXITCODE -ne 0) {
    throw 'Compiling the Rust test executables failed.'
}

# Cargo identifies test executables explicitly; never launch the application binary.
$executables = @($buildOutput | ForEach-Object {
    $artifact = $_ | ConvertFrom-Json
    if ($artifact.reason -eq 'compiler-artifact' -and $artifact.profile.test -and $artifact.executable) {
        $artifact.executable
    }
} | Sort-Object -Unique)
if ($executables.Count -eq 0) {
    throw 'Cargo did not produce any test executables.'
}

foreach ($executable in $executables) {
    $probe = Join-Path ([IO.Path]::GetTempPath()) ("devboot-test-" + [guid]::NewGuid() + ".xml")
    try {
        $probeOutput = & $mt -nologo "-inputresource:$executable;#1" "-out:$probe" 2>&1
        if ($LASTEXITCODE -eq 0) {
            # Merge the dependency into an existing manifest, preserving its other settings.
            $resourceOption = "-updateresource:$executable;#1"
        } elseif (($probeOutput -join ' ') -match 'c101008c' -and
                  (($probeOutput -join ' ') -match 'specified resource (type|name|data).*cannot be found' -or
                   ($probeOutput -join ' ') -match 'specified image file did not contain a resource section')) {
            $resourceOption = "-outputresource:$executable;#1"
        } else {
            throw "Unable to inspect the test manifest: $probeOutput"
        }
        & $mt -nologo -manifest $testManifest $resourceOption
        if ($LASTEXITCODE -ne 0) {
            throw "Embedding the test manifest failed: $executable"
        }
    } finally {
        if (Test-Path $probe) { Remove-Item $probe }
    }
    Write-Host "Running Rust tests: $executable"
    & $executable
    if ($LASTEXITCODE -ne 0) {
        throw "Rust tests failed: $executable"
    }
}
