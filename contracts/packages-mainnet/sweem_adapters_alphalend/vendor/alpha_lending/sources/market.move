/// Interface for the market module that handles market operations and configurations
module alpha_lending::market {
    use sui::coin::{Coin};
    use sui::clock::{Clock};
    use sui::balance::{Balance, Supply};
    use std::type_name::{TypeName};
    use alpha_lending::oracle::{PriceIdentifier};
    use alpha_lending::rewards::{RewardDistributor};
    use alpha_lending::flow_limiter::{FlowLimiter};
    use alphafi_stdlib::math::Number;

    // Public structs
    public struct XToken<phantom C> has drop, store {}
    
    // Trying to transact with a market that is not refreshed
    const ErrMarketNotRefreshed :u64 = 3;
    // Market does not have enough tokens to borrow
    const ErrNotEnoughTokensToBorrow:u64 = 4;
    // Coin type and market do not match
    const ErrCoinTypeMisMatched:u64 = 5;  
    // Maret does not have enought liquidity to withdraw
    const ErrNotEnoughLiquidity:u64 = 14;
    // XToken ratio decreased
    const ErrXTokenRatioDecreased:u64 = 23;
    // Tyring to borrow more than the borrow limit
    const ErrBorrowLimitExceeded:u64 = 30;
    // Tyring to borrow more than the borrow limit
    const ErrInvalidBorrowLimitPercentage:u64 = 31;
    // Could not fulfill promise
    const ErrCouldNotFulfillPromise:u64 = 37;
    // Could not fulfill promise fee
    const ErrCouldNotFulfillPromiseFee:u64 = 38;
    // Invalid promise market id
    const ErrInvalidPromiseMarketId:u64 = 39;
    // Not enough SUI to borrow
    const ErrNotEnoughSuiToBorrow:u64 = 42;
  

    public struct MarketConfig has store {
        safe_collateral_ratio: u8,
        liquidation_threshold: u8,
        deposit_limit: u64,
        borrow_limit: u64,
        partner_cap_required_for_deposit: bool,
        partner_cap_required_for_borrow: bool,
        borrow_fee_bps: u64,
        deposit_fee_bps: u64,
        withdraw_fee_bps: u64,
        collateral_types: vector<TypeName>,
        interest_rate_kinks: vector<u8>,
        interest_rates: vector<u16>,
        liquidation_bonus_bps: u64,
        liquidation_fee_bps: u64,
        spread_fee_bps: u64,
        isolated: bool,
        cascade_market_id: u64,
        protocol_fee_share_bps: u64,
        protocol_spread_fee_share_bps: u64,
        time_lock: u64,
        last_updated: u64,
        is_native: bool,
        borrow_weight: Number,
        active: bool,
        close_factor_percentage: u8,
    }

    public struct Market has key, store {
        id: UID,
        coin_type: TypeName,
        xtoken_type: TypeName,
        config: MarketConfig,
        reward_distributor: Option<RewardDistributor>,
        flow_limiter: FlowLimiter,
        price_identifier: PriceIdentifier,
        decimal_digit: Number,
        compounded_interest: Number,
        last_auto_compound: u64,
        borrowed_amount: u64,
        writeoff_amount: u64,
    }

    public struct MarketCap has key, store {
        id: UID,
        market_id: u64,
    }

   

    public struct LiquidityPromise<phantom C>{
        market_id: u64,
        coin_type: TypeName,
        liquidity_promise: u64,
        fee: u64,
    }
} 
