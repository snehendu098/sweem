/// Interface for managing lending positions in the Alpha Lending protocol
module alpha_lending::position {
    use sui::object::{ID, UID};
    use sui::vec_map::{VecMap};
    use sui::balance::{Balance};
    use sui::coin::{Coin};
    use sui::clock::{Clock};
    use std::type_name::{TypeName};
    use alpha_lending::market::{XToken, Market};
    use alpha_lending::rewards::{UserRewardDistributor};
    use alphafi_stdlib::math::Number;
    use std::string::{Self,String,utf8};


/// Error when attempting to liquidate a healthy position
    const ErrNotEligbleForLiquidation: u64 = 0;
    /// Error when attempting to liquidate with incorrect coin type
    const ErrWrongCoinTypeForLiquidation: u64 = 1;
    /// Error when accessing a position that hasn't been refreshed
    const ErrStalePosition: u64 = 2;
    /// Error when attempting to withdraw more collateral than available
    const ErrInsufficientCollateral: u64 = 3;
    /// Error when attempting to remove collateral while loans are outstanding
    const ErrBorrowNotFullyRepaid: u64 = 4;
    /// Error when attempting to interact with wrong Bluefin pool
    const ErrWrongPool: u64 = 5;
    /// Error when attempting to write off a position with remaining collateral
    const ErrPositionNoWriteoff: u64 = 6;
    /// Error when attempting to interact with stale LP position
    const ErrStaleLPPosition: u64 = 7;
    /// Error when attempting to interact with wrong LP position
    const ErrWrongLPPosition: u64 = 8;
    /// Error when attempting to interact with wrong position type
    const ErrInvalidPositionType: u64 = 9;
    // Public structs
    public struct PositionCap has store, key {
        id: UID,
        position_id: ID,
        client_address: address,
        image_url: String
    }

    public struct Position has store, key {  
        id: UID,
        partner_id: Option<ID>,
        lp_collaterals: Option<LpPositionCollateral>,
        collaterals: VecMap<u64,u64>,
        loans: vector<Borrow>,
        total_collateral_usd: Number,
        safe_collateral_usd: Number,
        liquidation_value: Number,
        additional_permissible_borrow_usd: Number,
        total_loan_usd: Number,
        spot_total_loan_usd: Number,
        weighted_total_loan_usd: Number,
        weighted_spot_total_loan_usd: Number,
        is_position_healthy: bool,
        is_position_liquidatable: bool,
        reward_distributors: vector<UserRewardDistributor>,
        is_isolated_borrowed: bool,
        last_refreshed: u64
    }

    public struct LpPositionCollateralConfig has drop, store {
        safe_collateral_ratio: u8,
        liquidation_threshold: u8,
        liquidation_bonus: u64,
        liquidation_fee: u64,
        close_factor_percentage: u8
    }

    public struct LpPositionCollateral has store {
        pool_id: ID,
        lp_position_id: ID,
        usd_value: Number,
        safe_usd_value: Number,
        liquidation_value: Number,
        liquidity: u128,
        config: LpPositionCollateralConfig,
        last_updated: u64,
        lp_type: u8
    }


    public struct Borrow has store {
        coin_type: TypeName,
        market_id: u64,
        amount: u64,
        borrow_time: u64,
        borrow_compounded_interest: Number,
        reward_distributor_index: u64
    }

    public fun is_healthy (
        position: &Position,
    ): bool {
        abort 0
    }

    public fun is_liquidatable(
        position: &Position,
        clock: &Clock
    ) : bool {
        abort 0
    }

    public fun get_position_id (
        position_cap: &PositionCap,
    ) : ID {
	abort 0
    }
    
} 
