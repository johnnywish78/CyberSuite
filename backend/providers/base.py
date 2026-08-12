from abc import ABC, abstractmethod


class ProviderError(RuntimeError):
    """Base provider-layer error."""


class DeploymentProvider(ABC):
    """Common contract for infrastructure providers."""

    name: str

    @abstractmethod
    async def verify_credentials(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    async def list_workers(self):
        raise NotImplementedError

    @abstractmethod
    async def list_deployments(self, worker_name: str):
        raise NotImplementedError
