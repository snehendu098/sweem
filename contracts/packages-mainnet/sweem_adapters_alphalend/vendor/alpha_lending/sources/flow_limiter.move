/// Interface for managing flow limits in the lending protocol
module alpha_lending::flow_limiter {
    use sui::clock::Clock;
    use alphafi_stdlib::math::Number;

    // Public structs
    public struct FlowLimiter has store {
        flow_delta: Number,
        last_update: u64,
        max_rate: u64,
        window_duration: u64
    }


} 