module alphafi_stdlib::math {

    const SCALE: u256 = 1000000000000000000;

    #[error]
    const ErrPercentageExceedHundred: u8 = 0;

    public struct Number has copy, drop, store {
        value: u256,
    }

    public fun from(value: u64) : Number {
        abort 0
    }

    public fun per_second_from_apr(value: u64) : Number {
        abort 0
    }

    public fun per_day_from_apr(value: u64) : Number {
        abort 0
    }

    public fun from_apr(value: u16) : Number {
        abort 0
    }

    public fun from_u128(value: u128) : Number {
        abort 0
    }

    public fun from_u8(value: u8) : Number {
        abort 0
    }

    public fun mul(a: Number, b: Number) : Number {
        abort 0
    }

    public fun div(a: Number, b: Number) : Number {
        abort 0
    }

    public fun div_round_up(a: Number, b: Number) : Number {
        abort 0
    }

    public fun round_up_u64(a: Number) : u64 {
        abort 0
    }

    public fun add(a: Number, b: Number) : Number {
        abort 0
    }

    public fun sub(a: Number, b: Number) : Number {
        abort 0
    }

    public fun safe_sub(a: Number, b: Number) : Number {
        abort 0
    }

    public fun to_u64(a: Number) : u64 {
        abort 0
    }

    public fun to_u128(a: Number) : u128 {
        abort 0
    }

    public fun to_percentage(a: Number) : u16 {
        abort 0
    }

    public fun from_percentage(value: u16) : Number {
        abort 0
    }

    public fun from_bps(value: u64) : Number {
        abort 0
    }

    public fun pow(a: Number, mut b: u64) : Number {
        abort 0
    }

    public fun min (a: Number, b: Number) : Number {
        abort 0
    }

    public fun max (a: Number, b: Number) : Number {
        abort 0
    }

    public fun gt (a: Number, b: Number) : bool {
        abort 0
    }

    public fun lt (a: Number, b: Number) : bool {
        abort 0
    }

    public fun ge (a: Number, b: Number) : bool {
        abort 0
    }

    public fun le (a: Number, b: Number) : bool {
        abort 0
    }

    public fun percentage_round_up(a: Number, b: u8) : Number {
        abort 0
    }

    public fun bps_round_up(a: Number, b: u64) : Number {
        abort 0
    }
    
    #[test_only]
    public fun get_value( a: &Number ) : u256 {
        abort 0
    }

    public fun eq (a: Number, b: Number) : bool {
        abort 0
    }
}
