// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { EquinoxOptionToken } from "../src/pool/EquinoxOptionToken.sol";

/// @notice FR-18: mint/burn hanya oleh pool yang diikat sekali; seriesId deterministik; totalSupply == OI.
contract EquinoxOptionTokenTest is Test {
    EquinoxOptionToken token;
    address pool = makeAddr("pool");
    address other = makeAddr("other");

    function setUp() public {
        token = new EquinoxOptionToken();
    }

    function test_bind_once_by_deployer() public {
        assertEq(token.deployer(), address(this));
        vm.prank(other);
        vm.expectRevert(EquinoxOptionToken.OnlyDeployer.selector);
        token.bindPool(pool);
        token.bindPool(pool);
        assertEq(token.pool(), pool);
        vm.expectRevert(EquinoxOptionToken.AlreadyBound.selector);
        token.bindPool(other);
    }

    function test_mint_burn_only_pool_and_supply() public {
        uint256 id = token.seriesId(pool, 1_790_928_000, 4200e18, true);
        vm.expectRevert(EquinoxOptionToken.OnlyPool.selector); // belum diikat
        token.mint(other, id, 1e18);
        token.bindPool(pool);
        vm.prank(other);
        vm.expectRevert(EquinoxOptionToken.OnlyPool.selector);
        token.mint(other, id, 1e18);
        vm.prank(pool);
        token.mint(other, id, 5e18);
        assertEq(token.totalSupply(id), 5e18);
        assertEq(token.balanceOf(other, id), 5e18);
        vm.prank(pool);
        token.burn(other, id, 2e18);
        assertEq(token.totalSupply(id), 3e18);
    }

    function test_seriesId_is_deterministic_and_distinct() public view {
        uint256 c = token.seriesId(pool, 1_790_928_000, 4200e18, true);
        uint256 p = token.seriesId(pool, 1_790_928_000, 4200e18, false);
        assertTrue(c != p);
        assertEq(c, uint256(keccak256(abi.encode(pool, uint64(1_790_928_000), uint128(4200e18), true))));
    }
}
