// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MemoPay} from "../src/MemoPay.sol";
import {MemoToken} from "./mocks/MemoToken.sol";

/// @notice Honest payments mixed with the calls MemoPay must refuse.
/// A refused call that does not revert is counted, and that count must stay zero.
contract MemoPayHandler is Test {
    MemoPay public immutable memo;
    MemoToken public immutable token;
    address public immutable alice;
    address public immutable bob;
    address public immutable sink;

    uint256 public successes;
    uint256 public hostileAccepted;
    address[] internal payers;
    bytes32[] internal hashes;
    uint256[] internal amounts;

    constructor(MemoPay memo_, MemoToken token_, address alice_, address bob_, address sink_) {
        memo = memo_;
        token = token_;
        alice = alice_;
        bob = bob_;
        sink = sink_;
    }

    function payerAt(uint256 i) external view returns (address) {
        return payers[i];
    }

    function hashAt(uint256 i) external view returns (bytes32) {
        return hashes[i];
    }

    function amountAt(uint256 i) external view returns (uint256) {
        return amounts[i];
    }

    function pay(uint8 who, uint96 amount, bytes32 hash) external {
        if (hash == bytes32(0)) return;
        amount = uint96(bound(amount, 1, 1_000_000));
        address payer = who % 2 == 0 ? alice : bob;
        if (token.balanceOf(payer) < amount) return;
        vm.prank(payer);
        try memo.pay(address(token), sink, amount, hash) {
            successes += 1;
            payers.push(payer);
            hashes.push(hash);
            amounts.push(amount);
        } catch {}
    }

    function replay() external {
        if (hashes.length == 0) return;
        uint256 i = hashes.length - 1;
        vm.prank(payers[i]);
        try memo.pay(address(token), sink, amounts[i], hashes[i]) {
            hostileAccepted += 1;
        } catch {}
    }

    function zeroHash() external {
        vm.prank(alice);
        try memo.pay(address(token), sink, 1, bytes32(0)) {
            hostileAccepted += 1;
        } catch {}
    }

    function paySelf(bytes32 hash) external {
        vm.prank(alice);
        try memo.pay(address(token), alice, 1, hash) {
            hostileAccepted += 1;
        } catch {}
    }

    function payTheContract(bytes32 hash) external {
        vm.prank(alice);
        try memo.pay(address(token), address(memo), 1, hash) {
            hostileAccepted += 1;
        } catch {}
    }
}

contract MemoPayInvariant is Test {
    uint256 internal constant MINT = 1_000_000_000_000;

    MemoPay internal memo;
    MemoToken internal token;
    MemoPayHandler internal handler;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal sink = address(0x51);

    function setUp() public {
        memo = new MemoPay();
        token = new MemoToken();
        token.mint(alice, MINT);
        token.mint(bob, MINT);
        vm.prank(alice);
        token.approve(address(memo), type(uint256).max);
        vm.prank(bob);
        token.approve(address(memo), type(uint256).max);
        handler = new MemoPayHandler(memo, token, alice, bob, sink);
        targetContract(address(handler));
    }

    function invariant_contractHoldsNothing() public view {
        assertEq(token.balanceOf(address(memo)), 0);
    }

    function invariant_supplyIsConstant() public view {
        assertEq(token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(sink), MINT * 2);
    }

    function invariant_noRefusedCallIsAccepted() public view {
        assertEq(handler.hostileAccepted(), 0);
    }

    function invariant_recordsMatchSuccessfulPays() public view {
        assertEq(memo.count(), handler.successes());
        uint256 n = handler.successes();
        for (uint256 i = 0; i < n; i++) {
            (address payee, address paidToken, uint256 amount, uint256 at) =
                memo.payment(handler.payerAt(i), handler.hashAt(i));
            assertEq(payee, sink);
            assertEq(paidToken, address(token));
            assertEq(amount, handler.amountAt(i));
            assertGt(at, 0);
        }
    }
}
