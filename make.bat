@echo off
setlocal enabledelayedexpansion

REM ==============================================================================
REM Disaster Risk Reduction (DRR) Agent Plugin - Windows Operational Batch Runner
REM Equivalent to Makefile for Windows Command Prompt (CMD) and PowerShell.
REM Usage: make <target> [VARIABLE=value ...]
REM Examples:
REM   make help
REM   make run
REM   make check
REM   make usgs MIN_MAG=6.0
REM   make forecast LAT=14.6 LON=121.0 DAYS=5
REM   make monitor INTERVAL=60
REM ==============================================================================

set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=help"

REM Default configurable variables (matching Makefile)
set "INTERVAL=60"
set "CONFIG_FILE=alerts-config.json"
set "MIN_MAG=5.0"
set "LAT=23.8"
set "LON=90.4"
set "DAYS=5"
set "DOCKER_IMAGE=undrr/drr-agent-plugin:latest"

REM Parse optional KEY=VALUE arguments after target (e.g. make usgs MIN_MAG=6.0)
shift
:parse_args
if "%~1"=="" goto dispatch
set "ARG=%~1"
echo !ARG! | findstr /r "^[A-Za-z_][A-Za-z0-9_]*=" >nul
if !errorlevel! equ 0 (
    set "!ARG!"
)
shift
goto parse_args

:dispatch
if /i "%TARGET%"=="help" goto target_help
if /i "%TARGET%"=="-h" goto target_help
if /i "%TARGET%"=="--help" goto target_help
if /i "%TARGET%"=="info" goto target_info
if /i "%TARGET%"=="version" goto target_info
if /i "%TARGET%"=="config-init" goto target_config_init
if /i "%TARGET%"=="config-check" goto target_config_check
if /i "%TARGET%"=="config-show" goto target_config_show
if /i "%TARGET%"=="alerts-validate" goto target_alerts_validate
if /i "%TARGET%"=="lint" goto target_lint
if /i "%TARGET%"=="test" goto target_test
if /i "%TARGET%"=="check" goto target_check
if /i "%TARGET%"=="inventory" goto target_inventory
if /i "%TARGET%"=="pre-commit-install" goto target_pre_commit_install
if /i "%TARGET%"=="run" goto target_serve
if /i "%TARGET%"=="serve" goto target_serve
if /i "%TARGET%"=="mcp" goto target_mcp
if /i "%TARGET%"=="monitor" goto target_monitor
if /i "%TARGET%"=="monitor-once" goto target_monitor_once
if /i "%TARGET%"=="usgs" goto target_usgs
if /i "%TARGET%"=="forecast" goto target_forecast
if /i "%TARGET%"=="scenario-earthquake" goto target_scenario_earthquake
if /i "%TARGET%"=="scenario-flood" goto target_scenario_flood
if /i "%TARGET%"=="scenario-cyclone" goto target_scenario_cyclone
if /i "%TARGET%"=="scenarios" goto target_scenarios
if /i "%TARGET%"=="thailand-flood" goto target_thailand_flood
if /i "%TARGET%"=="presentation" goto target_presentation
if /i "%TARGET%"=="gis-map" goto target_gis_map
if /i "%TARGET%"=="sitrep-sample" goto target_sitrep_sample
if /i "%TARGET%"=="clean-alerts" goto target_clean_alerts
if /i "%TARGET%"=="docker-build" goto target_docker_build
if /i "%TARGET%"=="docker-up" goto target_docker_up
if /i "%TARGET%"=="docker-start" goto target_docker_up
if /i "%TARGET%"=="docker-down" goto target_docker_down
if /i "%TARGET%"=="docker-stop" goto target_docker_down
if /i "%TARGET%"=="docker-restart" goto target_docker_restart
if /i "%TARGET%"=="docker-status" goto target_docker_status
if /i "%TARGET%"=="docker-ps" goto target_docker_status
if /i "%TARGET%"=="docker-logs" goto target_docker_logs
if /i "%TARGET%"=="docker-test" goto target_docker_test
if /i "%TARGET%"=="docker-once" goto target_docker_once
if /i "%TARGET%"=="docker-shell" goto target_docker_shell

echo Unknown target: "%TARGET%"
echo Run "make help" to see all available targets.
exit /b 1

REM ------------------------------------------------------------------------------
REM 1. Help & Information
REM ------------------------------------------------------------------------------

:target_help
echo Disaster Risk Reduction (DRR) Agent Plugin - Windows Operational Shortcuts
echo Standard: agent-plugins.org v1.0.0 ^| Runtime: Node.js ^>=18 (0 external npm deps)
echo.
echo Usage: make ^<target^> [VARIABLE=value ...]
echo.
echo   help                 Show this help message with all operational shortcuts
echo   info / version       Show runtime versions, git commit, and manifest metadata
echo   config-init          Initialize .env and alerts-config.json from templates
echo   config-check         Validate syntax and integrity of .env and alerts-config.json
echo   config-show          Display active configuration settings (masking secrets)
echo   alerts-validate      Validate declarative alert rules in alerts-config.json
echo   lint                 Run zero-dependency static lint ^& syntax checker
echo   test                 Run all 24 unit ^& MCP test suites (pure Node.js, no bash required)
echo   check                Run full pre-commit gate (lint + all 24 test suites)
echo   inventory            Regenerate docs\tool-inventory.md from registration sources
echo   pre-commit-install   Install automatic Git pre-commit hook into .git\hooks
echo   run / serve          Launch local web server ^& OSM tile proxy on http://localhost:3300
echo   mcp                  Start the JSON-RPC 2.0 stdio Model Context Protocol server
echo   monitor              Run the autonomous early warning daemon (INTERVAL=60)
echo   monitor-once         Run a bounded single-run shadow monitor check (read-only)
echo   usgs                 Fetch real-time USGS earthquakes (MIN_MAG=5.0)
echo   forecast             Fetch Open-Meteo rainfall screening (LAT=23.8 LON=90.4 DAYS=5)
echo   scenario-earthquake  Run HAZUS MMI-to-PGA + CAP XML earthquake scenario
echo   scenario-flood       Run GDACS flood spatial exposure scenario
echo   scenario-cyclone     Run cyclone wind speed ^& situation brief scenario
echo   scenarios            Run all three scenario pipelines
echo   thailand-flood       Run Southern Thailand flood hindcast validation scenario
echo   presentation         Show links and instructions for executive slide decks
echo   gis-map              Show link and launch instructions for offline GIS console
echo   sitrep-sample        Generate executive HTML Situation Report from HAZUS scenario
echo   clean-alerts         Remove generated CAP XMLs and reports from alerts\
echo   docker-build         Build the lightweight Alpine Docker image
echo   docker-up / start    Start the autonomous monitoring daemon in the background
echo   docker-down / stop   Stop the running monitoring daemon and containers
echo   docker-restart       Restart the monitoring daemon container
echo   docker-status / ps   Show running container status and health
echo   docker-logs          Follow live logs from the monitoring daemon container
echo   docker-test          Run the full test suite inside the Alpine container
echo   docker-once          Run a single monitor scan inside the Alpine container
echo   docker-shell         Open an interactive shell inside the Alpine container
exit /b 0

:target_info
echo Plugin Manifest:
node -e "const p = require('./plugin.json'); console.log('  Name:        ' + p.name + ' (v' + p.version + ')'); console.log('  Description: ' + p.description);"
echo.
echo Environment:
for /f "delims=" %%v in ('node -v 2^>nul') do echo   Node.js:     %%v
for /f "delims=" %%c in ('git rev-parse --short HEAD 2^>nul') do echo   Git Commit:  %%c
exit /b 0

REM ------------------------------------------------------------------------------
REM 2. Configuration Shortcuts
REM ------------------------------------------------------------------------------

:target_config_init
echo Initializing configuration files...
if not exist ".env" (
    copy ".env.example" ".env" >nul
    echo   Created .env from .env.example
) else (
    echo   .env already exists, skipping.
)
if not exist "alerts-config.json" (
    copy "alerts-config.example.json" "alerts-config.json" >nul
    echo   Created alerts-config.json from alerts-config.example.json
) else (
    echo   alerts-config.json already exists, skipping.
)
if not exist "alerts" mkdir "alerts"
echo   Ensured alerts\ directory exists.
echo Initialization complete. Edit .env or alerts-config.json to customize settings.
exit /b 0

:target_config_check
echo Checking configuration integrity...
node -e "const { CONFIG } = require('./lib/config.js'); console.log('  OK Config module loaded successfully.'); console.log('  OK USGS API: ' + CONFIG.USGS_API_URL); console.log('  OK GDACS Feed: ' + CONFIG.GDACS_FEED_URL); console.log('  OK Open-Meteo: ' + CONFIG.OPENMETEO_API_URL); console.log('  OK DELTA MCP API: ' + CONFIG.DELTA_API_URL); console.log('  OK Target Country Scope: ' + CONFIG.TARGET_COUNTRIES.join(', ')); console.log('  OK Strict DELTA Country Push: ' + CONFIG.DELTA_COUNTRY_STRICT); console.log('  OK Offline Mode: ' + CONFIG.DRR_OFFLINE_MODE);"
if errorlevel 1 exit /b 1
if exist "alerts-config.json" (
    node -e "const c = JSON.parse(require('fs').readFileSync('alerts-config.json','utf8')); const n = c.rules ? (Array.isArray(c.rules) ? c.rules.length : Object.keys(c.rules).length) : 0; console.log('  OK alerts-config.json is valid JSON (' + n + ' rules declared).');"
) else if exist "alerts-config.example.json" (
    node -e "const c = JSON.parse(require('fs').readFileSync('alerts-config.example.json','utf8')); const n = c.rules ? (Array.isArray(c.rules) ? c.rules.length : Object.keys(c.rules).length) : 0; console.log('  ! alerts-config.json missing; using alerts-config.example.json (' + n + ' rules).');"
)
exit /b %errorlevel%

:target_config_show
node -e "const { CONFIG } = require('./lib/config.js'); console.log('Active Configuration Settings:'); console.log('  TARGET_COUNTRIES:       ' + CONFIG.TARGET_COUNTRIES.join(', ')); console.log('  DELTA_COUNTRY:          ' + (CONFIG.DELTA_COUNTRY || '[NONE]')); console.log('  DELTA_COUNTRY_STRICT:   ' + CONFIG.DELTA_COUNTRY_STRICT); console.log('  USGS_MIN_MAGNITUDE:     ' + CONFIG.USGS_MIN_MAGNITUDE); console.log('  DRR_REQUEST_TIMEOUT_MS: ' + CONFIG.REQUEST_TIMEOUT_MS); console.log('  DRR_OFFLINE_MODE:       ' + CONFIG.DRR_OFFLINE_MODE); console.log('  DELTA_MCP_API_KEY:      ' + (CONFIG.DELTA_MCP_API_KEY ? '****' + CONFIG.DELTA_MCP_API_KEY.slice(-4) : '[NONE]')); console.log('  HTTP_PROXY:             ' + (CONFIG.HTTP_PROXY || '[NONE]'));"
exit /b %errorlevel%

:target_alerts_validate
node -e "const fs = require('fs'); const f = fs.existsSync('alerts-config.json') ? 'alerts-config.json' : 'alerts-config.example.json'; const c = JSON.parse(fs.readFileSync(f,'utf8')); if (!c.rules || typeof c.rules !== 'object') throw new Error('rules must be an object or array'); const n = Array.isArray(c.rules) ? c.rules.length : Object.keys(c.rules).length; console.log('OK ' + f + ' passed validation: ' + n + ' active rule(s).');"
exit /b %errorlevel%

REM ------------------------------------------------------------------------------
REM 3. Local Operational Shortcuts
REM ------------------------------------------------------------------------------

:target_lint
node scripts\lint.js
exit /b %errorlevel%

:target_test
echo ==================================================
echo  Running All DRR Agent Plugin Unit ^& MCP Tests
echo ==================================================
set "TEST_COUNT=0"
for %%f in (tests\test-*.js) do (
    set /a TEST_COUNT+=1
    node "%%f"
    if errorlevel 1 (
        echo FAILED: %%f
        exit /b 1
    )
)
echo ==================================================
echo  ALL !TEST_COUNT! TEST SUITES PASSED SUCCESSFULLY!
echo ==================================================
exit /b 0

:target_check
call "%~f0" lint
if errorlevel 1 exit /b 1
call "%~f0" test
exit /b %errorlevel%

:target_inventory
node scripts\generate-inventory.js
exit /b %errorlevel%

:target_pre_commit_install
node scripts\install-git-hook.js
exit /b %errorlevel%

:target_serve
node bin\serve.js
exit /b %errorlevel%

:target_mcp
node bin\mcp-server.js
exit /b %errorlevel%

:target_monitor
if not exist "alerts" mkdir "alerts"
set "CFG=%CONFIG_FILE%"
if not exist "!CFG!" set "CFG=alerts-config.example.json"
node bin\cli.js monitor --interval %INTERVAL% --config "!CFG!"
exit /b %errorlevel%

:target_monitor_once
set "CFG=%CONFIG_FILE%"
if not exist "!CFG!" set "CFG=alerts-config.example.json"
node bin\cli.js monitor --once --read-only true --config "!CFG!"
exit /b %errorlevel%

:target_usgs
node bin\cli.js usgs --min-mag %MIN_MAG%
exit /b %errorlevel%

:target_forecast
node bin\cli.js forecast --lat %LAT% --lon %LON% --days %DAYS%
exit /b %errorlevel%

:target_scenario_earthquake
where bash >nul 2>nul
if errorlevel 1 (
    echo Running earthquake scenario via Node CLI...
    node bin\cli.js spatial-join --hazard examples\earthquake-hazus-scenario\input-hazard.json --exposure examples\earthquake-hazus-scenario\input-exposure.json > examples\earthquake-hazus-scenario\spatial-report.json
    if errorlevel 1 exit /b 1
    node bin\cli.js vulnerability --spatial examples\earthquake-hazus-scenario\spatial-report.json --hazard earthquake --intensity 0.40 > examples\earthquake-hazus-scenario\vulnerability-report.json
    exit /b %errorlevel%
)
bash examples/earthquake-hazus-scenario/run.sh
exit /b %errorlevel%

:target_scenario_flood
where bash >nul 2>nul
if errorlevel 1 (
    echo Running flood scenario via Node CLI...
    node bin\cli.js gdacs --file examples\flood-gdacs-exposure\sample-gdacs-flood.json
    exit /b %errorlevel%
)
bash examples/flood-gdacs-exposure/run.sh
exit /b %errorlevel%

:target_scenario_cyclone
where bash >nul 2>nul
if errorlevel 1 (
    echo Git Bash is recommended for full shell scenarios. Running wind fragility check...
    node bin\cli.js fragility --hazard wind --intensity 210
    exit /b %errorlevel%
)
bash examples/cyclone-emergency-brief/run.sh
exit /b %errorlevel%

:target_scenarios
call "%~f0" scenario-earthquake
if errorlevel 1 exit /b 1
call "%~f0" scenario-flood
if errorlevel 1 exit /b 1
call "%~f0" scenario-cyclone
exit /b %errorlevel%

:target_thailand_flood
where bash >nul 2>nul
if errorlevel 1 (
    echo Running Southern Thailand flood hindcast via Node CLI...
    node bin\cli.js spatial-join --hazard examples\thailand-flood-scenario\input-hazard.json --exposure examples\thailand-flood-scenario\input-exposure.json > examples\thailand-flood-scenario\spatial-report.json
    if errorlevel 1 exit /b 1
    node bin\cli.js vulnerability --spatial examples\thailand-flood-scenario\spatial-report.json --hazard flood --intensity 2.2 > examples\thailand-flood-scenario\vulnerability-report.json
    exit /b %errorlevel%
)
bash examples/thailand-flood-scenario/run.sh
exit /b %errorlevel%

:target_presentation
echo Executive ^& Technical Slide Decks:
echo   Interactive HTML Deck: docs\presentation\slides.html
echo   Marp Markdown Deck:    docs\presentation\drr-agent-plugin-presentation.md
echo.
echo Export to PowerPoint (.pptx) via Marp:
echo   npx @marp-team/marp-cli docs/presentation/drr-agent-plugin-presentation.md -o presentation.pptx
exit /b 0

:target_gis_map
echo Offline GIS Mapping ^& Spatial Presentation Console:
echo   Viewer Location: docs\presentation\gis-map-presentation.html
echo   Launch local preview server with: make run
exit /b 0

:target_sitrep_sample
node bin\cli.js sitrep --file examples\earthquake-hazus-scenario\vulnerability-report.json --html --output examples\earthquake-hazus-scenario\situation-report.html
if errorlevel 1 exit /b 1
echo OK Visual SitRep generated: examples\earthquake-hazus-scenario\situation-report.html
exit /b 0

:target_clean_alerts
if exist "alerts\*.xml" del /q "alerts\*.xml"
if exist "alerts\*.json" del /q "alerts\*.json"
if exist "alerts\*.md" del /q "alerts\*.md"
echo Cleaned generated files from alerts\
exit /b 0

REM ------------------------------------------------------------------------------
REM 4. Docker Container Shortcuts
REM ------------------------------------------------------------------------------

:target_docker_build
docker compose build
exit /b %errorlevel%

:target_docker_up
if not exist "alerts" mkdir "alerts"
docker compose up -d drr-monitor
exit /b %errorlevel%

:target_docker_down
docker compose down
exit /b %errorlevel%

:target_docker_restart
docker compose restart drr-monitor
exit /b %errorlevel%

:target_docker_status
docker compose ps
exit /b %errorlevel%

:target_docker_logs
docker compose logs -f drr-monitor
exit /b %errorlevel%

:target_docker_test
docker compose run --rm drr-cli test
exit /b %errorlevel%

:target_docker_once
docker compose run --rm drr-cli monitor --once
exit /b %errorlevel%

:target_docker_shell
docker compose run --rm drr-cli sh
exit /b %errorlevel%
