// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MemoPay} from "../src/MemoPay.sol";
import {MemoToken} from "./mocks/MemoToken.sol";

contract MemoPayTest is Test {
    MemoPay internal memo;
    MemoToken internal token;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA201);

    function setUp() public {
        memo = new MemoPay();
        token = new MemoToken();
        vm.warp(1_700_000_000);
    }

    function test_pay_movesTheExactAmountAndRecordsTheHash() public {
        bytes32 hash = keccak256("ciphertext");
        _fund(alice, 10);
        vm.expectEmit(true, true, true, true);
        emit MemoPay.Paid(alice, bob, hash, address(token), 4);
        _pay(alice, bob, 4, hash);

        assertEq(token.balanceOf(alice), 6);
        assertEq(token.balanceOf(bob), 4);
        assertEq(token.balanceOf(address(memo)), 0);
        assertEq(memo.count(), 1);
        (address payee, address paidToken, uint256 amount, uint256 at) = memo.payment(alice, hash);
        assertEq(payee, bob);
        assertEq(paidToken, address(token));
        assertEq(amount, 4);
        assertEq(at, block.timestamp);
    }

    function test_pay_calldataIsFourWords() public pure {
        bytes memory data = abi.encodeCall(MemoPay.pay, (address(0x1), address(0x2), uint256(3), bytes32(uint256(4))));
        assertEq(data.length, 4 + 32 * 4);
    }

    function test_payment_isEmptyBeforePay() public view {
        (address payee, address paidToken, uint256 amount, uint256 at) = memo.payment(alice, keccak256("x"));
        assertEq(payee, address(0));
        assertEq(paidToken, address(0));
        assertEq(amount, 0);
        assertEq(at, 0);
    }

    function test_pay_refusesAZeroHash() public {
        _fund(alice, 1);
        vm.expectRevert(MemoPay.ZeroHash.selector);
        _pay(alice, bob, 1, bytes32(0));
        assertEq(token.balanceOf(alice), 1);
        assertEq(memo.count(), 0);
    }

    function test_pay_refusesAZeroAmount() public {
        _fund(alice, 1);
        vm.expectRevert(MemoPay.ZeroAmount.selector);
        _pay(alice, bob, 0, keccak256("x"));
    }

    function test_pay_refusesABadAddress() public {
        _fund(alice, 4);
        bytes32 hash = keccak256("x");
        address[4] memory sinks = [address(0), address(memo), address(token), alice];
        for (uint256 i = 0; i < sinks.length; i++) {
            vm.expectRevert(MemoPay.BadAddress.selector);
            _pay(alice, sinks[i], 1, hash);
        }
        vm.expectRevert(MemoPay.BadAddress.selector);
        _payToken(alice, bob, address(memo), 1, hash);
        assertEq(token.balanceOf(alice), 4);
        assertEq(memo.count(), 0);
    }

    function test_pay_refusesTheSameCiphertextFromTheSamePayer() public {
        bytes32 hash = keccak256("memo");
        _fund(alice, 10);
        _pay(alice, bob, 4, hash);
        vm.expectRevert(abi.encodeWithSelector(MemoPay.AlreadyPaid.selector, alice, hash));
        _pay(alice, bob, 4, hash);
        assertEq(token.balanceOf(alice), 6);
        assertEq(token.balanceOf(bob), 4);
        assertEq(memo.count(), 1);
    }

    function test_pay_letsAnotherPayerCommitToTheSameHash() public {
        bytes32 hash = keccak256("memo");
        _fund(alice, 5);
        _fund(carol, 5);
        _pay(alice, bob, 5, hash);
        _pay(carol, bob, 5, hash);
        assertEq(token.balanceOf(bob), 10);
        assertEq(memo.count(), 2);
    }

    function test_pay_letsTheSamePayerCommitToAnotherHash() public {
        _fund(alice, 6);
        _pay(alice, bob, 2, keccak256("one"));
        _pay(alice, bob, 3, keccak256("two"));
        assertEq(token.balanceOf(alice), 1);
        assertEq(memo.count(), 2);
    }

    function test_pay_refusesAShortBalance() public {
        _fund(alice, 1);
        vm.expectRevert(MemoPay.TransferFailed.selector);
        _pay(alice, bob, 2, keccak256("x"));
        assertEq(token.balanceOf(alice), 1);
        assertEq(memo.count(), 0);
    }

    function test_pay_refusesWithoutAllowance() public {
        token.mint(alice, 5);
        vm.expectRevert(MemoPay.TransferFailed.selector);
        _pay(alice, bob, 5, keccak256("x"));
        assertEq(token.balanceOf(alice), 5);
    }

    function test_pay_refusesATokenThatReturnsFalse() public {
        _fund(alice, 5);
        token.setMode(MemoToken.Mode.ReturnFalse);
        vm.expectRevert(MemoPay.TransferFailed.selector);
        _pay(alice, bob, 5, keccak256("x"));
        assertEq(token.balanceOf(alice), 5);
        assertEq(memo.count(), 0);
    }

    function test_pay_refusesATokenThatReverts() public {
        _fund(alice, 5);
        token.setMode(MemoToken.Mode.Revert);
        vm.expectRevert(MemoPay.TransferFailed.selector);
        _pay(alice, bob, 5, keccak256("x"));
    }

    function test_pay_refusesATokenThatPaysShort() public {
        _fund(alice, 5);
        token.setMode(MemoToken.Mode.Short);
        vm.expectRevert(MemoPay.TransferFailed.selector);
        _pay(alice, bob, 5, keccak256("x"));
        assertEq(token.balanceOf(bob), 0);
        assertEq(token.balanceOf(address(memo)), 0);
    }

    function test_pay_refusesATokenThatSkimsIntoTheContract() public {
        _fund(alice, 5);
        token.setMode(MemoToken.Mode.Skim);
        vm.expectRevert(MemoPay.TransferFailed.selector);
        _pay(alice, bob, 5, keccak256("x"));
        assertEq(token.balanceOf(address(memo)), 0);
    }

    function test_pay_refusesATokenThatOverchargesThePayer() public {
        _fund(alice, 6);
        token.setMode(MemoToken.Mode.Overcharge);
        vm.expectRevert(MemoPay.TransferFailed.selector);
        _pay(alice, bob, 5, keccak256("x"));
        assertEq(token.balanceOf(alice), 6);
    }

    function test_pay_acceptsATokenThatReturnsNothing() public {
        _fund(alice, 5);
        token.setMode(MemoToken.Mode.EmptyReturn);
        _pay(alice, bob, 5, keccak256("x"));
        assertEq(token.balanceOf(bob), 5);
        assertEq(token.balanceOf(address(memo)), 0);
        assertEq(memo.count(), 1);
    }

    function testFuzz_pay_movesTheExactAmount(uint96 amount, bytes32 hash) public {
        amount = uint96(bound(amount, 1, 1_000_000e6));
        vm.assume(hash != bytes32(0));
        _fund(alice, amount);
        _pay(alice, bob, amount, hash);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(bob), amount);
        assertEq(token.balanceOf(address(memo)), 0);
        (address payee, address paidToken, uint256 paid, uint256 at) = memo.payment(alice, hash);
        assertEq(payee, bob);
        assertEq(paidToken, address(token));
        assertEq(paid, amount);
        assertEq(at, block.timestamp);
    }

    function _fund(address payer, uint256 amount) internal {
        token.mint(payer, amount);
        vm.prank(payer);
        token.approve(address(memo), type(uint256).max);
    }

    function _pay(address payer, address payee, uint256 amount, bytes32 hash) internal {
        _payToken(payer, payee, address(token), amount, hash);
    }

    function _payToken(address payer, address payee, address coin, uint256 amount, bytes32 hash) internal {
        vm.prank(payer);
        memo.pay(coin, payee, amount, hash);
    }
}
