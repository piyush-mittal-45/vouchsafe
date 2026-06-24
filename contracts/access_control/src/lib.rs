#![no_std]
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct AccessControl;

#[contractimpl]
impl AccessControl {
    pub fn hello(_env: Env) -> u32 {
        0
    }
}
