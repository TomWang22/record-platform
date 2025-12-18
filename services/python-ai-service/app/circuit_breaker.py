"""
Circuit Breaker Pattern for External API Calls
Prevents cascading failures by skipping external APIs when they're failing
"""
import asyncio
import time
from typing import Optional, Dict
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class CircuitState(Enum):
    CLOSED = "closed"  # Normal operation, allow requests
    OPEN = "open"  # Failing, skip requests
    HALF_OPEN = "half_open"  # Testing if service recovered


class CircuitBreaker:
    """
    Circuit breaker for external API calls
    
    Opens circuit after failure_threshold failures within failure_window_seconds
    Closes circuit after success_threshold successes in half-open state
    """
    
    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        failure_window_seconds: float = 60.0,
        success_threshold: int = 2,
        half_open_timeout_seconds: float = 30.0,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.failure_window_seconds = failure_window_seconds
        self.success_threshold = success_threshold
        self.half_open_timeout_seconds = half_open_timeout_seconds
        
        self.state = CircuitState.CLOSED
        self.failures: list[float] = []  # Timestamps of failures
        self.successes: int = 0
        self.last_failure_time: Optional[float] = None
        self.opened_at: Optional[float] = None
        self._lock = asyncio.Lock()
    
    async def call(self, func, *args, **kwargs):
        """
        Execute function with circuit breaker protection
        
        Returns:
            Result of func() if circuit is closed or half-open
            None if circuit is open (skipped)
        """
        async with self._lock:
            # Check if circuit should transition from open to half-open
            if self.state == CircuitState.OPEN:
                if self.opened_at and (time.time() - self.opened_at) >= self.half_open_timeout_seconds:
                    logger.info(f"[circuit-breaker] {self.name}: Transitioning OPEN -> HALF_OPEN (testing recovery)")
                    self.state = CircuitState.HALF_OPEN
                    self.successes = 0
                else:
                    # Circuit still open, skip request
                    logger.debug(f"[circuit-breaker] {self.name}: Circuit OPEN, skipping request")
                    return None
            
            # Clean old failures outside the window
            now = time.time()
            self.failures = [f for f in self.failures if (now - f) <= self.failure_window_seconds]
        
        # Execute function
        try:
            result = await func(*args, **kwargs)
            
            # Success - update circuit state
            async with self._lock:
                if self.state == CircuitState.HALF_OPEN:
                    self.successes += 1
                    if self.successes >= self.success_threshold:
                        logger.info(f"[circuit-breaker] {self.name}: Transitioning HALF_OPEN -> CLOSED (recovered)")
                        self.state = CircuitState.CLOSED
                        self.failures = []
                        self.successes = 0
                elif self.state == CircuitState.CLOSED:
                    # Reset failures on success (circuit is healthy)
                    if len(self.failures) > 0:
                        self.failures = []
            
            return result
        
        except Exception as e:
            # Failure - update circuit state
            async with self._lock:
                now = time.time()
                self.failures.append(now)
                self.last_failure_time = now
                
                # Clean old failures
                self.failures = [f for f in self.failures if (now - f) <= self.failure_window_seconds]
                
                if len(self.failures) >= self.failure_threshold:
                    if self.state != CircuitState.OPEN:
                        logger.warning(
                            f"[circuit-breaker] {self.name}: Opening circuit "
                            f"({len(self.failures)} failures in {self.failure_window_seconds}s)"
                        )
                        self.state = CircuitState.OPEN
                        self.opened_at = now
                elif self.state == CircuitState.HALF_OPEN:
                    # Failure in half-open state, go back to open
                    logger.warning(f"[circuit-breaker] {self.name}: Still failing, back to OPEN")
                    self.state = CircuitState.OPEN
                    self.opened_at = now
                    self.successes = 0
            
            # Re-raise exception
            raise
    
    def get_state(self) -> CircuitState:
        """Get current circuit state"""
        return self.state
    
    def get_stats(self) -> Dict:
        """Get circuit breaker statistics"""
        return {
            "name": self.name,
            "state": self.state.value,
            "failures": len(self.failures),
            "successes": self.successes,
            "last_failure_time": self.last_failure_time,
            "opened_at": self.opened_at,
        }


# Global circuit breakers for external APIs
_ebay_circuit: Optional[CircuitBreaker] = None
_discogs_circuit: Optional[CircuitBreaker] = None


def get_ebay_circuit_breaker() -> CircuitBreaker:
    """Get or create eBay circuit breaker"""
    global _ebay_circuit
    if _ebay_circuit is None:
        _ebay_circuit = CircuitBreaker(
            name="ebay",
            failure_threshold=5,  # Open after 5 failures
            failure_window_seconds=60.0,  # Within 60 seconds
            success_threshold=2,  # Close after 2 successes
            half_open_timeout_seconds=30.0,  # Test recovery after 30s
        )
    return _ebay_circuit


def get_discogs_circuit_breaker() -> CircuitBreaker:
    """Get or create Discogs circuit breaker"""
    global _discogs_circuit
    if _discogs_circuit is None:
        _discogs_circuit = CircuitBreaker(
            name="discogs",
            failure_threshold=5,  # Open after 5 failures
            failure_window_seconds=60.0,  # Within 60 seconds
            success_threshold=2,  # Close after 2 successes
            half_open_timeout_seconds=30.0,  # Test recovery after 30s
        )
    return _discogs_circuit

