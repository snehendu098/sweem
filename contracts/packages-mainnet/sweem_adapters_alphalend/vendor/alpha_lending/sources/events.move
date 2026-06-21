/// Interface for event handling in the lending protocol
module alpha_lending::events {
    // Public structs
    public struct Event<T: copy + drop> has copy, drop {
        event: T,
    }

} 