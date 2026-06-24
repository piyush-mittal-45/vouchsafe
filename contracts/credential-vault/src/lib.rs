#![no_std]
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct CredentialVault;

#[contractimpl]
impl CredentialVault {
    pub fn hello(_env: Env) -> u32 {
        0
    }
}
