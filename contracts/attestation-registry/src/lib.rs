#![no_std]
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct AttestationRegistry;

#[contractimpl]
impl AttestationRegistry {
    pub fn hello(_env: Env) -> u32 {
        0
    }
}
