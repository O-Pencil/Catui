# Connect a local model server

On a fresh launch, choose **5) Local/custom server** in the setup menu to enter
the TUI without a cloud Coding Plan key. In interactive mode, enter `/model`
and choose **OpenAI-compatible**.
Paste the URL printed by FreeToken, Ollama, LM Studio, vLLM, or another server
implementing the OpenAI model-list and chat-completions endpoints.

An origin such as `http://127.0.0.1:1919` is normalized to
`http://127.0.0.1:1919/v1`. An explicit API prefix is preserved. Use the server's
LAN address when it runs on another computer.

Catui queries `/models` under that API prefix. A single served model is selected
automatically; multiple models produce a picker. A server returning HTTP 401/403
prompts for its API key. An unavailable or unsupported model-list endpoint shows
the failure and offers retry or manual model-ID entry. A changed endpoint never
receives the previous endpoint's saved key automatically.

Review the model and token limits, then choose **Save configuration** or
**Adjust limits**. Limits explicitly returned by the server take priority;
saved limits apply only to the same endpoint and model. If the server does not
report limits, Catui labels its conservative defaults: 8192 context tokens and
up to 2048 output tokens. Adjust these to your actual deployment; a model's
advertised maximum may exceed the context length configured on your server.

Canceling any prompt leaves configuration and credentials unchanged. Selecting
OpenAI-compatible again lets you reconfigure the endpoint.

Servers needing no authentication require no user-provided API key. Catui stores
the nonsecret `catui-no-auth` compatibility value because its current runtime
and OpenAI SDK require a nonempty key. Chat requests carry that placeholder as
a Bearer header; model discovery omits it. If your server enforces authentication,
use its actual key.
