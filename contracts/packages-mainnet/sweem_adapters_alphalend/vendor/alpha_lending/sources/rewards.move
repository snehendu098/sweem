/// Interface for managing rewards in the lending protocol
module alpha_lending::rewards {
    use sui::object::{ID, UID};
    use std::type_name::{TypeName};
    use alphafi_stdlib::math::Number;

    // Public structs
    public struct RewardDistributor has key, store {
        id: UID,
        total_xtokens: u64,
        rewards: vector<Option<Reward>>,
        last_updated: u64,
        market_id: u64
    }

    public struct Reward has key, store {
        id: UID,
        coin_type: TypeName,
        distributor_id: ID,
        is_auto_compounded: bool,
        auto_compound_market_id: u64,
        total_rewards: u64,
        start_time: u64,
        end_time: u64,
        distributed_rewards: Number,
        cummulative_rewards_per_share: Number
    }

    public struct UserRewardDistributor has store {
        reward_distributor_id: ID,
        market_id: u64,
        share: u64,
        rewards: vector<Option<UserReward>>,
        last_updated: u64,
        is_deposit: bool
    }

    public struct UserReward has store {
        reward_id: ID,
        coin_type: TypeName,
        earned_rewards: Number,
        cummulative_rewards_per_share: Number,
        is_auto_compounded: bool,
        auto_compound_market_id: u64
    }

    public struct ClaimableReward has copy, drop {
        market_id: u64,
        reward_type: TypeName
    }
} 