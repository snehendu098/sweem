/// Interface for managing partners in the lending protocol
module alpha_lending::partner {
    use sui::object::{ID, UID};

    // Public structs
    public struct Partner has key, store {
        id: UID,
        address: address,
        fee_discount_bps: u64
    }

    public struct PartnerCap has key, store {
        id: UID,
        partner_id: ID,
    }

    
} 