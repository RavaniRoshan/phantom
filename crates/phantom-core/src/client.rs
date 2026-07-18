use phantom_proto::{
    phantom_llm_client::PhantomLlmClient, ActionRequest, PlanRequest, PlanResponse,
    ThinkingChunk,
};
use tokio_stream::Stream;
use tonic::transport::Channel;

/// Retry parameters for transient gRPC failures.
const MAX_RETRIES: u32 = 3;
const BASE_BACKOFF_MS: u64 = 250;

/// Run `f`, retrying on transient failures with exponential backoff.
///
/// `f` is invoked once per attempt; it may rebuild its request from cloned
/// data, so callers should pass request types that are `Clone`.
async fn retry_unary<F, Fut, T, E>(mut f: F) -> anyhow::Result<T>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let mut last_err = None;
    for attempt in 0..MAX_RETRIES {
        match f().await {
            Ok(value) => return Ok(value),
            Err(e) => {
                last_err = Some(e.to_string());
                if attempt + 1 < MAX_RETRIES {
                    tokio::time::sleep(std::time::Duration::from_millis(
                        BASE_BACKOFF_MS * (1 << attempt),
                    ))
                    .await;
                }
            }
        }
    }
    Err(anyhow::anyhow!(
        "RPC failed after {MAX_RETRIES} retries: {}",
        last_err.unwrap_or_else(|| "unknown error".to_string())
    ))
}

/// Thin async client around the Python `PhantomLLM` gRPC service.
///
/// The Rust side is the client; the Python `phantom_llm` service is the server.
/// All calls retry on transient transport errors with exponential backoff.
#[derive(Clone)]
pub struct PhantomClient {
    inner: PhantomLlmClient<Channel>,
}

impl PhantomClient {
    /// Connect to the LLM service at `endpoint` (e.g. `http://127.0.0.1:50051`).
    pub async fn connect(endpoint: &str) -> anyhow::Result<Self> {
        let mut last_err = None;
        for attempt in 0..MAX_RETRIES {
            match Channel::from_shared(endpoint.to_string())?.connect().await {
                Ok(channel) => {
                    return Ok(Self {
                        inner: PhantomLlmClient::new(channel),
                    })
                }
                Err(e) => {
                    last_err = Some(e);
                    if attempt + 1 < MAX_RETRIES {
                        tokio::time::sleep(std::time::Duration::from_millis(
                            BASE_BACKOFF_MS * (1 << attempt),
                        ))
                        .await;
                    }
                }
            }
        }
        Err(last_err
            .map(|e| anyhow::anyhow!("failed to connect to {endpoint}: {e}"))
            .unwrap_or_else(|| anyhow::anyhow!("failed to connect to {endpoint}")))
    }

    /// Decompose a task into ordered subtasks.
    pub async fn plan_task(&self, task: &str, mode: &str) -> anyhow::Result<PlanResponse> {
        let req = PlanRequest {
            task: task.to_string(),
            mode: mode.to_string(),
        };
        let client = self.inner.clone();
        let resp = retry_unary(|| {
            let mut c = client.clone();
            let r = req.clone();
            async move { c.plan_task(r).await.map(|x| x.into_inner()) }
        })
        .await?;
        Ok(resp)
    }

    /// Ask the LLM for the next action given the current request.
    pub async fn decide_action(&self, req: ActionRequest) -> anyhow::Result<phantom_proto::ActionResponse> {
        let client = self.inner.clone();
        let resp = retry_unary(|| {
            let mut c = client.clone();
            let r = req.clone();
            async move { c.decide_action(r).await.map(|x| x.into_inner()) }
        })
        .await?;
        Ok(resp)
    }

    /// Stream reasoning chunks for a request. Returns the async stream directly.
    pub async fn stream_thinking(
        &self,
        req: ActionRequest,
    ) -> anyhow::Result<impl Stream<Item = Result<ThinkingChunk, tonic::Status>>> {
        let resp = self.inner.clone().stream_thinking(req).await?;
        Ok(resp.into_inner())
    }
}
