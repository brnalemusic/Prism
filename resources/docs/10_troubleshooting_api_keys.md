# Master Troubleshooting and System Diagnostics Guide

## 1. Introduction: Multi-Provider Reliability

Prism is a hybrid desktop application coordinating local file workflows, shell terminals, web engines, and cloud/local Large Language Model APIs across multiple providers.

This document details common failure modes, error codes, and step-by-step diagnostic workflows for:
- API Keys and Provider Authentication
- Custom Base URLs & Endpoint Connections
- safeStorage Cryptographic Decryption Failures
- Text-to-Speech (TTS) & Dictation Issues
- Sandboxed Terminal Execution Blocks

---

## 2. API Key Authentication and Provider Errors

Because Prism connects to multiple providers (Google AI Studio, OpenAI, Anthropic, OpenRouter, NVIDIA NIM, Groq, Cerebras, Puter.js, Ollama, LM Studio), HTTP response codes provide clear diagnostics:

### 2.1. HTTP Error Code Reference

#### `HTTP 401 Unauthorized (Invalid API Key)`
- **Cause:** The API key passed in headers is invalid, expired, or revoked.
- **Resolution:** Open **System Settings**, select target Provider, enter a valid API key, and click **Save**.

#### `HTTP 403 Forbidden / Access Denied`
- **Cause:** Account lacks permissions for selected model, or endpoint is restricted in user region.
- **Resolution:** Verify model availability in provider console. Switch active model or route via alternative provider (e.g. OpenRouter).

#### `HTTP 429 Rate Limit Exceeded`
- **Cause:** Quota limit (RPM/TPM) reached on target provider.
- **Resolution:**
  1. Wait 60 seconds for quota window reset.
  2. Switch active model to an alternative provider using the dropdown or Quick Launcher `Ctrl+M` hotkey.
  3. Reduce context length by starting a fresh chat session (`Ctrl+N`).

#### `Base URL Connection Refused (Custom / Local Endpoints)`
- **Cause:** Local model server (e.g. Ollama `http://localhost:11434` or LM Studio `http://localhost:1234`) is not running, or CORS headers block Electron origin.
- **Resolution:** Ensure local LLM server is active and accessible via HTTP GET `/models`.

---

## 3. safeStorage Configuration Encryption

Prism encrypts API keys using Electron's `safeStorage` module before writing settings.

### 3.1. safeStorage Decryption Failure
- **Symptom:** API keys appear empty or settings reset on app startup.
- **Cause:** Host OS user password was changed, or config files were copied to a different user profile/machine, invalidating OS encryption keys (Windows DPAPI / Mac Keychain).
- **Resolution:**
  1. Close Prism.
  2. Locate app data config folder (`C:\Users\Username\.gemini\antigravity\config` or app root).
  3. Delete `prismconfigs.cfg`.
  4. Relaunch Prism and re-enter provider credentials in Settings.

---

## 4. Text-to-Speech (TTS) Diagnostics

- **Formatting Crashes (HTTP 500):** Voice synthesis engines can fail when encountering unparsed LaTeX math blocks or complex markdown code snippets.
- **Resolution:** Switch active voice profile in Settings (`Aoede`, `Puck`, `Charon`, `Kore`, `Fenrir`) or ask AI to output plain text responses.
