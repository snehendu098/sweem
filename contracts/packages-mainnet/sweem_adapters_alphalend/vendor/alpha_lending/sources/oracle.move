/// Interface for managing price oracle functionality in the lending protocol
module alpha_lending::oracle {
    use std::type_name::{TypeName};
    use sui::clock::Clock;
    use alphafi_stdlib::math::Number;
    use alphafi_oracle::oracle::PriceInfo as OraclePriceInfo;
    use sui::object::UID;

    // Oracle price not updated for a while
    const ErrStaleOraclePrice: u64 = 0;
    // Public structs
    public struct PriceIdentifier has copy, drop, store {
        coin_type: TypeName,
    }

    public struct Oracle has store, key {
        id: UID,
        price_identifiers: vector<PriceIdentifier>,
        price_staleness_threshold: u64
    }

    public struct PriceInfo has store, key {
        id: UID,
        coin_type: TypeName,
        price: Number,
        ema_price: Number,
        last_updated: u64,
    }

    /// Updates the price information for a specific coin
    /// * `oracle` - Mutable reference to the oracle
    /// * `price_identifier` - Price identifier for the coin
    /// * `price` - New price information
    public fun update_price(
        oracle: &mut Oracle,
        price: &OraclePriceInfo
    ) {
        abort 0
    }
} 