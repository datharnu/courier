// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice A token that can be honest, or can lie about what it moved. MemoPay must refuse every lie.
contract MemoToken {
    enum Mode {
        Honest,
        ReturnFalse,
        Revert,
        Short,
        Skim,
        EmptyReturn,
        Overcharge
    }

    Mode public mode;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (mode == Mode.Revert) revert("no");
        if (mode == Mode.ReturnFalse) return false;

        uint256 cost = mode == Mode.Overcharge ? amount + 1 : amount;
        require(balanceOf[from] >= cost && allowance[from][msg.sender] >= cost, "balance");
        balanceOf[from] -= cost;
        allowance[from][msg.sender] -= cost;
        if (mode == Mode.Short) {
            balanceOf[to] += amount - 1;
        } else if (mode == Mode.Skim) {
            balanceOf[to] += amount;
            balanceOf[msg.sender] += 1;
        } else {
            balanceOf[to] += amount;
        }
        if (mode == Mode.EmptyReturn) {
            assembly {
                return(0, 0)
            }
        }
        return true;
    }
}
